"""Monash FODMAP stacking, GLUT5/GLUT2 co-transport, Starling osmotic flux and
coupled SIBO/IMO H2–CH4 Monod fermentation kinetics (Python 3.12 reference solver).

Every routine has a deterministic ES2024 mirror in src/lib/engines/fodmapFermentationEngine.js
so the Android APK and disconnected browsers compute identical numbers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable

MW = {
    "fructans": 162.0,
    "gos": 504.0,
    "lactose": 342.0,
    "excessFructose": 180.0,
    "sorbitol": 182.0,
    "mannitol": 182.0,
}

GROUP_ORDER = ("fructans", "gos", "lactose", "excessFructose", "sorbitol", "mannitol")

# Calibrated lumped constant: Lp·A_mucosa·σ·R·T expressed per mmol of luminal osmolyte.
OSMOTIC_LUMPED_ML_PER_MMOL = 8.0


@dataclass
class MealVector:
    """Six-subgroup FODMAP load with macro context."""

    grams: dict[str, float] = field(default_factory=dict)
    fat_g: float = 14.0
    glucose_g: float = 0.0
    weight_kg: float = 70.0

    def get(self, key: str) -> float:
        return float(self.grams.get(key, 0.0))

    @property
    def total_g(self) -> float:
        return sum(self.get(g) for g in GROUP_ORDER)


def glut_transport(
    fructose_g: float,
    glucose_g: float,
    glut5_capacity_g: float = 4.5,
    km_glut5_mm: float = 11.0,
) -> dict:
    """GLUT5 low-capacity apical diffusion vs glucose-activated GLUT2 insertion.

    M_unabsorbed = max(0, (M_fructose - M_glucose) - C_GLUT5,max)
    """
    net = max(0.0, fructose_g - glucose_g)
    unabsorbed = max(0.0, net - glut5_capacity_g)
    glucose_rescue = max(0.0, fructose_g - glut5_capacity_g)
    return {
        "net_fructose_g": round(net, 4),
        "unabsorbed_fructose_g": round(unabsorbed, 4),
        "absorbed_fructose_g": round(net - unabsorbed, 4),
        "glucose_rescue_g": round(glucose_rescue, 3),
        "km_glut5_mm": km_glut5_mm,
        "rescued": unabsorbed <= 0.0,
        "note": (
            f"Add about {glucose_rescue:.1f} g glucose to activate apical GLUT2 insertion."
            if unabsorbed > 0
            else "Fructose load within GLUT5 capacity - no glucose rescue needed."
        ),
    }


def osmotic_flux(meal: MealVector, unabsorbed_fraction: float = 0.85) -> dict:
    """Starling lumen water secretion: V = Lp·A·σ·R·T · Σ(m_i / MW_i)."""
    mmol_total = 0.0
    per_group: dict[str, float] = {}
    for group in GROUP_ORDER:
        mmol = meal.get(group) * unabsorbed_fraction * 1000.0 / MW[group]
        per_group[group] = round(mmol, 4)
        mmol_total += mmol
    return {
        "mmol_total": round(mmol_total, 3),
        "volume_ml": round(mmol_total * OSMOTIC_LUMPED_ML_PER_MMOL, 2),
        "per_group_mmol": per_group,
    }


def _monod_derivative(substrate: float, h2: float, y_h2: float, mu_max: float, ks: float,
                      x_bact: float, k_meth: float, x_archaea: float, k_clear: float
                      ) -> tuple[float, float, float, float]:
    growth = y_h2 * mu_max * substrate / (ks + substrate) * x_bact
    methanogenesis = k_meth * h2 * x_archaea
    d_substrate = -mu_max * substrate / (ks + substrate) * x_bact
    d_h2 = growth - 4.0 * methanogenesis - k_clear * h2  # 4 H2 + CO2 -> CH4 + 2 H2O
    d_ch4 = methanogenesis
    d_h2s = 0.02 * growth * (1.0 - min(1.0, x_archaea))
    return d_substrate, d_h2, d_ch4, d_h2s


def fermentation_ode(
    substrate_g: float = 8.0,
    methanogen_load: float = 0.4,
    dt: float = 1.0,
    t_end: float = 480.0,
    sibo: bool = True,
    y_h2: float = 16.0,
    mu_max: float = 0.045,
    ks: float = 2.2,
    k_meth: float = 0.0018,
    k_clear: float = 0.01,
) -> dict:
    """RK4 integration of coupled bacterial H2 / archaeal CH4 kinetics (0-480 min)."""
    x_bact = 1.0 if sibo else 0.55
    x_archaea = max(0.0, methanogen_load)

    substrate, h2, ch4, h2s = substrate_g, 0.0, 0.0, 0.4
    series: list[dict] = [{"t": 0.0, "S": substrate, "H2": 0.0, "CH4": 0.0, "H2S": h2s * 2.1}]

    def deriv(s: float, h: float) -> tuple[float, float, float, float]:
        return _monod_derivative(s, h, y_h2, mu_max, ks, x_bact, k_meth, x_archaea, k_clear)

    t = dt
    while t <= t_end + 1e-9:
        k1 = deriv(substrate, h2)
        k2 = deriv(substrate + k1[0] * dt / 2, h2 + k1[1] * dt / 2)
        k3 = deriv(substrate + k2[0] * dt / 2, h2 + k2[1] * dt / 2)
        k4 = deriv(substrate + k3[0] * dt, h2 + k3[1] * dt)
        substrate = max(0.0, substrate + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]))
        h2 = max(0.0, h2 + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]))
        ch4 = max(0.0, ch4 + dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]))
        h2s = h2s + dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
        if round(t) % 5 == 0:
            series.append({"t": round(t, 2), "S": substrate, "H2": h2, "CH4": ch4, "H2S": h2s * 2.1})
        t += dt

    peak_h2 = max(p["H2"] for p in series)
    peak_ch4 = max(p["CH4"] for p in series)
    rise_90 = max((p["H2"] for p in series if p["t"] <= 90.0), default=0.0)
    t_peak = next((p["t"] for p in series if p["H2"] == peak_h2), 0.0)
    return {
        "series": series,
        "peak_H2_ppm": round(peak_h2, 3),
        "peak_CH4_ppm": round(peak_ch4, 3),
        "h2_rise_90min_ppm": round(rise_90, 3),
        "t_peak_min": t_peak,
        "sibo_positive": rise_90 >= 20.0,
        "imo_positive": peak_ch4 >= 10.0,
        "criteria": {
            "sibo": f"H2 rise >=20 ppm within <=90 min: {rise_90:.1f} ppm",
            "imo": f"CH4 >=10 ppm any time: peak {peak_ch4:.1f} ppm",
        },
    }


def laplace_wall_tension(pressure_kpa: float = 0.8, radius_cm: float = 2.8, wall_mm: float = 3.0) -> dict:
    """T = P·r / (2h) converted to kPa (r and h in mm)."""
    radius_mm = radius_cm * 10.0
    tension = pressure_kpa * radius_mm / (2.0 * wall_mm)
    return {
        "tension_kpa": round(tension, 4),
        "hypersensitivity_risk": tension > 4.0,
        "note": "Wall tension above 4.0 kPa correlates with visceral hypersensitivity.",
    }


def enzyme_rescue(meal: MealVector) -> dict:
    """Precision exogenous enzyme dosing before the meal."""
    lactose = meal.get("lactose")
    gos = meal.get("gos")
    fructan = meal.get("fructans")
    lactase_alu = lactose * 1800.0
    alpha_gal_galu = (gos + 0.6 * fructan) * 450.0
    lipase_usp = meal.fat_g * 2000.0
    cap = 2500.0 * meal.weight_kg
    xylose_mg = max(0.0, meal.get("excessFructose") - 4.5) * 0.9 * 1000.0 / 180.0 * 60.0
    return {
        "lactase_alu": int(round(lactase_alu)),
        "alpha_galactosidase_galu": int(round(alpha_gal_galu)),
        "xylose_isomerase_mg": int(round(xylose_mg)),
        "lipase_usp": int(round(min(lipase_usp, cap))),
        "lipase_capped": lipase_usp > cap,
        "lipase_cap_usp": round(cap, 1),
    }


def stacking_score(meal: MealVector) -> dict:
    total = meal.total_g
    stacked_groups = sum(1 for g in GROUP_ORDER if meal.get(g) >= 2.0)
    if total > 12:
        verdict = "High stacking load - osmotic and fermentation symptoms likely"
    elif total > 6:
        verdict = "Moderate stacking - monitor symptoms"
    else:
        verdict = "Low stacking - Monash green-serve range"
    return {"total_g": round(total, 3), "stacked_groups": stacked_groups, "verdict": verdict}


def simulate_meal(payload: dict) -> dict:
    """Full pipeline used by the Vercel Python function."""
    grams = {k: float(payload.get(k, 0.0) or 0.0) for k in GROUP_ORDER}
    meal = MealVector(
        grams=grams,
        fat_g=float(payload.get("fat_g", 14.0) or 14.0),
        glucose_g=float(payload.get("glucose_g", 0.0) or 0.0),
        weight_kg=float(payload.get("weight_kg", 70.0) or 70.0),
    )
    glut = glut_transport(meal.get("excessFructose") + meal.glucose_g, meal.glucose_g)
    osm = osmotic_flux(meal)
    fermentation = fermentation_ode(
        substrate_g=max(1.0, meal.total_g),
        methanogen_load=float(payload.get("methanogen_load", 0.4) or 0.4),
    )
    tension = laplace_wall_tension(
        pressure_kpa=float(payload.get("pressure_kpa", 1.2) or 1.2),
        radius_cm=float(payload.get("radius_cm", 3.2) or 3.2),
    )
    return {
        "engine": "python-3.12",
        "stacking": stacking_score(meal),
        "glut_transport": glut,
        "osmotic_flux": osm,
        "fermentation": fermentation,
        "wall_tension": tension,
        "enzymes": enzyme_rescue(meal),
        "meals": list(GROUP_ORDER),
    }
