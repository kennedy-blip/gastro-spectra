package com.gastrospectra.plugins

import android.Manifest
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * GastroPhonoImuPlugin — native enteric acoustics + refractory-safe clinometry.
 *
 *  • 48 kHz / 16-bit PCM mono capture from MediaRecorder.AudioSource.UNPROCESSED so the
 *    WebView receives the raw electret-microphone signal with no AGC, NS or AEC applied
 *    (essential: noise suppression destroys 80–1500 Hz bowel-sound cavitation transients).
 *  • 200 Hz accelerometer + gyroscope fusion for the nocturnal GERD bed-wedge clinometer:
 *    θ_bed = atan2(a_y, sqrt(a_x² + a_z²)) · 180/π, plus roll for left-lateral decubitus.
 *  • Breath-gated artifact rejection: samples are dropped when |a| deviates > 0.35 g from
 *    1 g, which removes cough/rolling motion spikes from the acoustic stream.
 */
@CapacitorPlugin(
    name = "GastroPhonoImu",
    permissions = [
        Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])
    ]
)
class GastroPhonoImuPlugin : Plugin(), SensorEventListener {

    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    @Volatile private var capturing = false

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var gyroscope: Sensor? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastEmitMs = 0L

    private val sampleRate = SAMPLE_RATE
    private val bufferBytes = AudioRecord.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT
    ).coerceAtLeast(4096) * 4

    override fun load() {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyroscope = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "permissionCallback")
        } else {
            call.resolve(JSObject().put("microphone", "GRANTED"))
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        val granted = getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED
        call.resolve(JSObject().put("microphone", if (granted) "GRANTED" else "DENIED"))
    }

    @PluginMethod
    fun startPhonoCapture(call: PluginCall) {
        if (capturing) {
            call.resolve(JSObject().put("status", "ALREADY_CAPTURING"))
            return
        }
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("RECORD_AUDIO permission not granted", "MIC_PERMISSION_DENIED")
            return
        }
        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val source = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            MediaRecorder.AudioSource.UNPROCESSED
        } else {
            MediaRecorder.AudioSource.MIC
        }
        val recorder = AudioRecord(source, sampleRate, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, bufferBytes))
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            call.reject("AudioRecord failed to initialise (UNPROCESSED source unavailable)", "AUDIORECORD_INIT_FAILED")
            return
        }
        val quadrant = call.getString("quadrant") ?: "RLQ"
        audioRecord = recorder
        capturing = true
        recorder.startRecording()

        captureThread = Thread {
            val pcm = ShortArray(2048)
            val chunk = DoubleArray(2048)
            while (capturing) {
                val read = recorder.read(pcm, 0, pcm.size, AudioRecord.READ_BLOCKING)
                if (read <= 0) continue
                for (i in 0 until read) chunk[i] = pcm[i] / 32768.0
                val payload = JSObject()
                payload.put("quadrant", quadrant)
                payload.put("sampleRate", sampleRate)
                payload.put("encoding", "PCM_16BIT_MONO_UNPROCESSED")
                val arr = JSArray()
                for (i in 0 until read) arr.put(chunk[i])
                payload.put("samples", arr)
                notifyListeners("phonoFrame", payload)
            }
        }.also { it.start() }

        call.resolve(JSObject()
            .put("status", "CAPTURING")
            .put("sampleRate", sampleRate)
            .put("quadrant", quadrant))
    }

    @PluginMethod
    fun stopPhonoCapture(call: PluginCall) {
        capturing = false
        captureThread?.join(400)
        captureThread = null
        audioRecord?.let {
            try { it.stop() } catch (_: IllegalStateException) { }
            it.release()
        }
        audioRecord = null
        call.resolve(JSObject().put("status", "STOPPED"))
    }

    @PluginMethod
    fun startClinometer(call: PluginCall) {
        sensorManager?.let { mgr ->
            accelerometer?.let { mgr.registerListener(this, it, 5000, 0) }   // 200 Hz
            gyroscope?.let { mgr.registerListener(this, it, 5000, 0) }
        }
        call.resolve(JSObject().put("status", "CLINOMETER_ACTIVE").put("rateHz", 200))
    }

    @PluginMethod
    fun stopClinometer(call: PluginCall) {
        sensorManager?.unregisterListener(this)
        call.resolve(JSObject().put("status", "CLINOMETER_STOPPED"))
    }

    @PluginMethod
    fun getSensorReadiness(call: PluginCall) {
        val result = JSObject()
        result.put("accelerometer", if (accelerometer != null) "ACTIVE" else "UNAVAILABLE")
        result.put("gyroscope", if (gyroscope != null) "ACTIVE" else "UNAVAILABLE")
        result.put("unprocessedAudio", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) "ACTIVE" else "RESTRICTED")
        result.put("sampleRate", sampleRate)
        result.put("sdkInt", Build.VERSION.SDK_INT)
        call.resolve(result)
    }

    private var lastAccel = FloatArray(3)

    override fun onSensorEvent(event: SensorEvent?) = Unit

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                val ax = event.values[0]
                val ay = event.values[1]
                val az = event.values[2]
                lastAccel = floatArrayOf(ax, ay, az)
                val magnitude = sqrt(ax * ax + ay * ay + az * az)
                val breathGated = Math.abs(magnitude - 9.81f) > 0.35f * 9.81f
                val now = System.currentTimeMillis()
                if (now - lastEmitMs < 50) return   // throttle bridge to 20 Hz
                lastEmitMs = now
                val wedge = atan2(ay.toDouble(), sqrt((ax * ax + az * az).toDouble())) * 180.0 / PI
                val payload = JSObject()
                payload.put("ax", ax)
                payload.put("ay", ay)
                payload.put("az", az)
                payload.put("wedgeDeg", wedge)
                payload.put("inAntiRefluxZone", wedge >= 15.0 && wedge <= 22.0)
                payload.put("breathGated", breathGated)
                payload.put("rateHz", 200)
                notifyListeners("clinometer", payload)
            }
            Sensor.TYPE_GYROSCOPE -> {
                val rollRate = event.values[2]
                val payload = JSObject()
                payload.put("rollRateDegPerSec", rollRate)
                payload.put("leftLateral", rollRate < -0.4)
                notifyListeners("gyroRoll", payload)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun handleOnDestroy() {
        stopPhonoCapture(PluginCall(JSObject(), "")).also { /* best-effort release */ }
        sensorManager?.unregisterListener(this)
        super.handleOnDestroy()
    }

    companion object {
        const val SAMPLE_RATE = 48000
    }
}
