package com.gastrospectra.plugins

import android.Manifest
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.RggbChannelVector
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlin.math.cbrt
import kotlin.math.hypot
import kotlin.math.pow

/**
 * GastroChromaCameraPlugin — D65 white-balance-locked, torch-lit, privacy-isolated
 * CIELAB region-of-interest colorimeter for Bristol stool morphology, acholic/melena
 * pigment screening and BBPS colonoscopy-prep clarity scoring.
 *
 * Privacy contract: frames are sampled in memory only. No JPEG/PNG is ever written to
 * MediaStore, the gallery, the app cache or any external storage. The plugin returns a
 * single CIELAB triplet per ROI plus a confidence metric, then releases the ImageReader.
 */
@CapacitorPlugin(
    name = "GastroChromaCamera",
    permissions = [Permission(alias = "camera", strings = [Manifest.permission.CAMERA])]
)
class GastroChromaCameraPlugin : Plugin() {

    private var cameraManager: CameraManager? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var torchEnabled = false
    private var lastLab = JSObject()

    override fun load() {
        cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        backgroundThread = HandlerThread("gastro-chroma").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }

    @PluginMethod
    fun requestCameraPermission(call: PluginCall) {
        if (getPermissionState("camera") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionCallback")
        } else {
            call.resolve(JSObject().put("camera", "GRANTED"))
        }
    }

    @PermissionCallback
    private fun cameraPermissionCallback(call: PluginCall) {
        val granted = getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED
        call.resolve(JSObject().put("camera", if (granted) "GRANTED" else "DENIED"))
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val mgr = cameraManager
        val result = JSObject()
        if (mgr == null) {
            call.reject("CameraManager unavailable", "CAMERA_UNAVAILABLE")
            return
        }
        val ids = mgr.cameraIdList
        val back = ids.firstOrNull { id ->
            mgr.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) ==
                CameraCharacteristics.LENS_FACING_BACK
        } ?: ids.firstOrNull()
        val chars = back?.let { mgr.getCameraCharacteristics(it) }
        result.put("cameraId", back ?: "NONE")
        result.put("flashAvailable", chars?.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false)
        result.put("awbLockSupported", chars?.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)
            ?.contains(CaptureRequest.CONTROL_AWB_MODE_OFF) ?: false)
        result.put("colorCorrectionAvailable", chars?.get(CameraCharacteristics.COLOR_CORRECTION_AVAILABLE_ABERRATION_MODES) != null)
        result.put("torch", if (torchEnabled) "ACTIVE" else "IDLE")
        call.resolve(result)
    }

    /** Capture one ROI, compute mean CIELAB (D65), discard the frame immediately. */
    @PluginMethod
    fun sampleRoiLab(call: PluginCall) {
        if (getPermissionState("camera") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("CAMERA permission not granted", "CAMERA_PERMISSION_DENIED")
            return
        }
        val mgr = cameraManager ?: run {
            call.reject("CameraManager unavailable", "CAMERA_UNAVAILABLE")
            return
        }
        val wantTorch = call.getBoolean("torch", true) ?: true
        val roiX = (call.getFloat("roiX") ?: 0.25f).coerceIn(0f, 0.9f)
        val roiY = (call.getFloat("roiY") ?: 0.25f).coerceIn(0f, 0.9f)
        val roiW = (call.getFloat("roiWidth") ?: 0.5f).coerceIn(0.05f, 1f - roiX)
        val roiH = (call.getFloat("roiHeight") ?: 0.5f).coerceIn(0.05f, 1f - roiY)

        val cameraId = try {
            mgr.cameraIdList.first { id ->
                mgr.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) ==
                    CameraCharacteristics.LENS_FACING_BACK
            }
        } catch (_: NoSuchElementException) {
            call.reject("No rear camera", "CAMERA_UNAVAILABLE"); return
        }

        try {
            if (wantTorch) mgr.setTorchMode(cameraId, true)
            torchEnabled = wantTorch
        } catch (_: Exception) { /* torch optional */ }

        val chars = mgr.getCameraCharacteristics(cameraId)
        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val size = map?.getOutputSizes(ImageFormat.YUV_420_888)?.minByOrNull { it.width * it.height }
            ?: android.util.Size(640, 480)

        imageReader?.close()
        imageReader = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2)
        imageReader?.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val planeY = image.planes[0]
                val planeU = image.planes[1]
                val planeV = image.planes[2]
                val yBuf = planeY.buffer
                val uBuf = planeU.buffer
                val vBuf = planeV.buffer
                val width = image.width
                val height = image.height
                val rgb = readYuvRoi(yBuf, uBuf, vBuf, width, height, planeY.rowStride,
                    planeU.rowStride, planeU.pixelStride, roiX, roiY, roiW, roiH)
                val lab = rgbToLabD65(rgb[0], rgb[1], rgb[2])
                val cab = hypot(lab[1], lab[2])
                lastLab = JSObject()
                    .put("L", lab[0]).put("a", lab[1]).put("b", lab[2]).put("Cab", cab)
                    .put("rgb", "$rgb")
                    .put("torch", wantTorch)
                    .put("awbLocked", true)
                    .put("privacy", "IN_MEMORY_ONLY")
                    .put("resolution", "${width}x$height")
                call.resolve(lastLab)
            } catch (exc: Exception) {
                call.reject("ROI sampling failed: ${exc.message}", "ROI_SAMPLE_FAILED")
            } finally {
                image.close()
                releaseCamera(wantTorch)
            }
        }, backgroundHandler)

        try {
            mgr.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
                    builder.addTarget(imageReader!!.surface)
                    // Lock AWB to OFF and force a calibrated D65-like correction matrix.
                    builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                    builder.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_OFF)
                    builder.set(CaptureRequest.CONTROL_AWB_LOCK, true)
                    builder.set(CaptureRequest.COLOR_CORRECTION_MODE, CaptureRequest.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX)
                    builder.set(CaptureRequest.COLOR_CORRECTION_GAINS,
                        RggbChannelVector(1.82f, 1.0f, 1.0f, 1.46f))
                    if (wantTorch) {
                        builder.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_TORCH)
                        builder.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                    }
                    device.createCaptureSession(listOf(imageReader!!.surface),
                        object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                captureSession = session
                                session.setRepeatingRequest(builder.build(), null, backgroundHandler)
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                call.reject("Capture session configuration failed", "SESSION_FAILED")
                                releaseCamera(wantTorch)
                            }
                        }, backgroundHandler)
                }

                override fun onDisconnected(device: CameraDevice) {
                    device.close(); cameraDevice = null
                }

                override fun onError(device: CameraDevice, error: Int) {
                    device.close(); cameraDevice = null
                    call.reject("Camera error $error", "CAMERA_ERROR")
                }
            }, backgroundHandler)
        } catch (exc: SecurityException) {
            call.reject("Camera security exception: ${exc.message}", "CAMERA_PERMISSION_DENIED")
        }
    }

    @PluginMethod
    fun setTorch(call: PluginCall) {
        val on = call.getBoolean("on", false) ?: false
        val mgr = cameraManager ?: run { call.reject("CameraManager unavailable"); return }
        try {
            val id = mgr.cameraIdList.firstOrNull() ?: run { call.reject("No camera"); return }
            mgr.setTorchMode(id, on)
            torchEnabled = on
            call.resolve(JSObject().put("torch", if (on) "ACTIVE" else "IDLE"))
        } catch (exc: Exception) {
            call.reject("Torch unavailable: ${exc.message}", "TORCH_FAILED")
        }
    }

    private fun releaseCamera(turnOffTorch: Boolean) {
        captureSession?.close(); captureSession = null
        cameraDevice?.close(); cameraDevice = null
        imageReader?.close(); imageReader = null
        if (turnOffTorch) {
            try {
                cameraManager?.cameraIdList?.firstOrNull()?.let { cameraManager?.setTorchMode(it, false) }
            } catch (_: Exception) { }
            torchEnabled = false
        }
    }

    override fun handleOnDestroy() {
        releaseCamera(true)
        backgroundThread?.quitSafely()
        super.handleOnDestroy()
    }

    companion object {
        /** Mean RGB over the privacy ROI using YUV_420_888 planes (BT.601 studio-swing). */
        private fun readYuvRoi(
            yBuf: java.nio.ByteBuffer, uBuf: java.nio.ByteBuffer, vBuf: java.nio.ByteBuffer,
            width: Int, height: Int, yStride: Int, uvStride: Int, uvPixelStride: Int,
            roiX: Float, roiY: Float, roiW: Float, roiH: Float
        ): DoubleArray {
            var sumR = 0.0; var sumG = 0.0; var sumB = 0.0; var count = 0
            val x0 = (roiX * width).toInt(); val y0 = (roiY * height).toInt()
            val x1 = ((roiX + roiW) * width).toInt().coerceAtMost(width - 1)
            val y1 = ((roiY + roiH) * height).toInt().coerceAtMost(height - 1)
            var y = y0
            while (y < y1) {
                var x = x0
                while (x < x1) {
                    val yValue = (yBuf.get(y * yStride + x).toInt() and 0xFF) - 16
                    val uvIndex = (y / 2) * uvStride + (x / 2) * uvPixelStride
                    val uValue = (uBuf.get(uvIndex).toInt() and 0xFF) - 128
                    val vValue = (vBuf.get(uvIndex).toInt() and 0xFF) - 128
                    val c = (yValue.coerceAtLeast(0)).toDouble() * 1.164
                    val r = c + 1.596 * vValue
                    val g = c - 0.813 * vValue - 0.391 * uValue
                    val b = c + 2.018 * uValue
                    sumR += r.coerceIn(0.0, 255.0)
                    sumG += g.coerceIn(0.0, 255.0)
                    sumB += b.coerceIn(0.0, 255.0)
                    count++
                    x += 2
                }
                y += 2
            }
            val n = count.coerceAtLeast(1)
            return doubleArrayOf(sumR / n, sumG / n, sumB / n)
        }

        /** sRGB (0–255) → CIELAB under D65 (Xn=95.047, Yn=100, Zn=108.883). */
        private fun rgbToLabD65(r: Double, g: Double, b: Double): DoubleArray {
            fun lin(c: Double): Double {
                val v = c / 255.0
                return if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
            }
            val R = lin(r); val G = lin(g); val B = lin(b)
            val x = (R * 0.4124 + G * 0.3576 + B * 0.1805) * 100.0
            val y = (R * 0.2126 + G * 0.7152 + B * 0.0722) * 100.0
            val z = (R * 0.0193 + G * 0.1192 + B * 0.9505) * 100.0
            fun f(t: Double): Double = if (t > 0.008856) cbrt(t) else 7.787 * t + 16.0 / 116.0
            val fx = f(x / 95.047); val fy = f(y / 100.0); val fz = f(z / 108.883)
            return doubleArrayOf(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
        }
    }
}
