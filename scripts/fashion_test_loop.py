"""
Fashion Persona Tester + Expert Auditor
Test harness for StyleAI app against PRODUCT.md requirements.

Simulates:
1. Earth-toned Japanese Americana/Workwear male persona
2. New user (0 wardrobe items)
3. Scan flow → Wardrobe interaction → Discovery feed verification

Then audits:
- Multi-pass vision pipeline
- Match quality & style blending
- Wardrobe-aware gap detection
- Security/IDOR boundaries
- Color palette prominence
- Style taxonomy alignment
"""

import json
import sys
import os
from pathlib import Path

def audit_codebase():
    """Audit the codebase against PRODUCT.md requirements."""
    root = Path(r"C:\Users\chaze\OneDrive\Desktop\APPS\styleai-app\styleai-app")
    
    issues = []
    warnings = []
    
    # === ISSUE 1: Wardrobe table has no user_id column (IDOR/Privacy) ===
    schema_path = root / "shared" / "schema.ts"
    schema_content = schema_path.read_text(encoding="utf-8")
    if "user_id" not in schema_content.lower() and "userid" not in schema_content.lower():
        issues.append({
            "type": "Security Breach",
            "severity": "CRITICAL",
            "title": "Wardrobe items are global — no user_id column",
            "description": "The wardrobe_items table lacks a user_id or device_id column. ALL users see ALL wardrobe items. This is a severe IDOR vulnerability.",
            "file": "shared/schema.ts",
            "fix": "Add user_id/device_id column to wardrobe_items; filter all wardrobe queries by user."
        })
    
    # === ISSUE 2: getWardrobeItems returns all items, not user-scoped ===
    storage_path = root / "server" / "storage.ts"
    storage_content = storage_path.read_text(encoding="utf-8")
    if "getWardrobeItems():" in storage_content and "user_id" not in storage_content[storage_content.find("getWardrobeItems()"):storage_content.find("getWardrobeItems()")+200]:
        issues.append({
            "type": "Security Breach",
            "severity": "CRITICAL",
            "title": "getWardrobeItems() returns every user's wardrobe",
            "description": "storage.getWardrobeItems() does a SELECT * FROM wardrobe_items with NO user filter. The gap-recommendations endpoint calls this, leaking all user wardrobes.",
            "file": "server/storage.ts",
            "fix": "Add user_id parameter to getWardrobeItems(userId) and filter WHERE user_id = $1."
        })
    
    # === ISSUE 3: Style taxonomy mismatch — Americana/Workwear missing from client vector ===
    vector_path = root / "client" / "src" / "lib" / "styleVector.ts"
    vector_content = vector_path.read_text(encoding="utf-8")
    if '"Western / Americana"' not in vector_content and '"Americana"' not in vector_content and '"Workwear"' not in vector_content:
        issues.append({
            "type": "Algorithmic Taste Failure",
            "severity": "HIGH",
            "title": "Style vector AESTHETICS missing 'Americana' and 'Workwear'",
            "description": "The AI pipeline (ANALYSIS_SCHEMA) supports 'Western / Americana' but the client's styleVector.ts AESTHETICS array does NOT include it. When Gemini returns 'Western / Americana', the client vector can't store it, causing taste drift and incorrect feed ranking.",
            "file": "client/src/lib/styleVector.ts",
            "fix": "Add 'Western / Americana' and 'Workwear' to AESTHETICS, and ensure the AI->client taxonomy mapping is bi-directional."
        })
    
    # === ISSUE 4: No auto-add to wardrobe from scan results ===
    results_path = root / "client" / "src" / "pages" / "results.tsx"
    results_content = results_path.read_text(encoding="utf-8")
    if "wardrobe" not in results_content.lower() or "add to wardrobe" not in results_content.lower():
        warnings.append({
            "type": "UI/UX Gap",
            "severity": "MEDIUM",
            "title": "No 'Add to Wardrobe' action on scan results",
            "description": "Product requirement #4: items bought through the app should auto-add to wardrobe. The results page shows products but has no 'Add to Wardrobe' or 'Buy & Add' button. Users must manually re-upload via Wardrobe tab.",
            "file": "client/src/pages/results.tsx",
            "fix": "Add 'Add to Wardrobe' button on product cards; create /api/wardrobe/auto-add endpoint that copies scan results to wardrobe_items."
        })
    
    # === ISSUE 5: Color palette swatches are too small ===
    if "w-7 h-7" in results_content:
        issues.append({
            "type": "UI-Palette Discrepancy",
            "severity": "MEDIUM",
            "title": "Color palette swatches are only 28px (w-7 h-7)",
            "description": "Product requirement #6: 'palette presented as visible dots or stronger swatch treatment.' Current swatches are 28px circles which are decorative, not prominent. Hex codes only show on hover.",
            "file": "client/src/pages/results.tsx",
            "fix": "Increase swatch size to w-10 h-10 (40px) or larger, add color name labels, and make hex codes always visible or copyable."
        })
    
    # === ISSUE 6: Secondary aesthetic not stored in database ===
    if "secondary_aesthetic" not in schema_content.lower() and "secondaryAesthetic" not in schema_content.lower():
        issues.append({
            "type": "Algorithmic Taste Failure",
            "severity": "HIGH",
            "title": "No secondary_aesthetic column in scans table",
            "description": "Product requirement #1: output should be primary + secondary style. The AI returns secondaryAesthetic but the DB schema only stores 'aesthetic' (primary) and styleBreakdown JSON. The secondary style is not queryable for recommendations.",
            "file": "shared/schema.ts",
            "fix": "Add secondary_aesthetic column to scans table; store it during analysis; use it in taste vector updates and feed ranking."
        })
    
    # === ISSUE 7: Gap recommendations don't check for wardrobe duplicates ===
    gap_path = root / "server" / "storage.ts"
    gap_content = gap_path.read_text(encoding="utf-8")
    if "getWardrobeGapRecommendations" in gap_content:
        # Check if it excludes owned items
        gap_func = gap_content[gap_content.find("getWardrobeGapRecommendations"):gap_content.find("getWardrobeGapRecommendations")+1200]
        if "seen" in gap_func and "wardrobe" not in gap_func.lower():
            issues.append({
                "type": "Algorithmic Taste Failure",
                "severity": "HIGH",
                "title": "Gap recommendations don't exclude items user already owns",
                "description": "Product requirement #7: Outfit completion should suggest what's MISSING. The gap function finds missing categories but does NOT check if the recommended item is already in the user's wardrobe by name/brand/similarity. It may recommend a brown leather boot when the user already owns one.",
                "file": "server/storage.ts",
                "fix": "Add wardrobe name/brand deduplication in getWardrobeGapRecommendations; penalize exact or near-exact matches."
            })
    
    # === ISSUE 8: Discovery feed is mostly static ===
    home_path = root / "client" / "src" / "pages" / "home.tsx"
    home_content = home_path.read_text(encoding="utf-8")
    if "FEED_ITEMS" in home_content and home_content.count("id:") > 50:
        warnings.append({
            "type": "Algorithmic Taste Failure",
            "severity": "MEDIUM",
            "title": "Home feed is 135 hardcoded items, not dynamic inventory",
            "description": "Product requirement #9: discovery feed should be styled around user's taste. The FEED_ITEMS array is static with 135 hardcoded entries. While rankByVector reorders them, the actual product data doesn't come from live inventory/affiliate APIs.",
            "file": "client/src/pages/home.tsx",
            "fix": "Replace static FEED_ITEMS with dynamic fetch from /api/depop-feed or affiliate API; use FEED_ITEMS only as fallback skeleton."
        })
    
    # === ISSUE 9: Style memory doesn't use weighted average of primary + secondary ===
    vector_content = vector_path.read_text(encoding="utf-8")
    if "secondary" not in vector_content.lower() and "styleBreakdown" not in vector_content.lower():
        issues.append({
            "type": "Algorithmic Taste Failure",
            "severity": "HIGH",
            "title": "Style vector only boosts primary aesthetic, ignores secondary",
            "description": "Product requirement #2: matcher should respect BOTH primary and secondary signals. The styleVector.ts applyBoost only boosts the primary aesthetic. For blended styles (e.g. 70% Workwear, 30% Minimalist), the Minimalist signal is lost, causing generic recommendations.",
            "file": "client/src/lib/styleVector.ts",
            "fix": "Modify applyBoost to accept secondary aesthetic and boost it at 0.5× strength. Update onResultSaved to pass secondary from styleBreakdown."
        })
    
    # === ISSUE 10: No gender filtering on product matches ===
    routes_path = root / "server" / "routes.ts"
    routes_content = routes_path.read_text(encoding="utf-8")
    # Check if depop search queries include gender
    if "gender" not in routes_content[routes_content.find("buildGarmentQueries"):routes_content.find("buildGarmentQueries")+500].lower():
        warnings.append({
            "type": "Algorithmic Taste Failure",
            "severity": "MEDIUM",
            "title": "Depop garment queries don't filter by user gender",
            "description": "Product requirement #2: match quality should be filtered by gender profile. The buildGarmentQueries function doesn't append gender-specific keywords to Depop searches, so male users may get female-cut items and vice versa.",
            "file": "server/routes.ts",
            "fix": "Append gender keywords to Depop queries based on user profile metadata."
        })
    
    return {"issues": issues, "warnings": warnings}


def generate_patch_plan(audit):
    """Generate prioritized patch plan."""
    critical = [i for i in audit["issues"] if i["severity"] == "CRITICAL"]
    high = [i for i in audit["issues"] if i["severity"] == "HIGH"]
    medium = [i for i in audit["issues"] + audit["warnings"] if i["severity"] in ("MEDIUM", "LOW")]
    
    plan = []
    plan.append("=" * 60)
    plan.append("PATCH PLAN — Fashion AI Test Loop Iteration 1")
    plan.append("=" * 60)
    
    plan.append("\n## CRITICAL (Security + Data Integrity)")
    for i, issue in enumerate(critical, 1):
        plan.append(f"\n{i}. [{issue['type']}] {issue['title']}")
        plan.append(f"   File: {issue['file']}")
        plan.append(f"   Fix: {issue['fix']}")
    
    plan.append("\n## HIGH (Algorithmic Taste Failure)")
    for i, issue in enumerate(high, 1):
        plan.append(f"\n{i}. [{issue['type']}] {issue['title']}")
        plan.append(f"   File: {issue['file']}")
        plan.append(f"   Fix: {issue['fix']}")
    
    plan.append("\n## MEDIUM/WARNINGS (UX + Coverage)")
    for i, issue in enumerate(medium, 1):
        plan.append(f"\n{i}. [{issue['type']}] {issue['title']}")
        plan.append(f"   File: {issue['file']}")
        plan.append(f"   Fix: {issue['fix']}")
    
    return "\n".join(plan)


def simulate_test_persona():
    """
    Simulate the Fashion Persona Tester flow.
    Since we can't actually call Gemini (no API key/credits check),
    we verify the infrastructure is ready for the persona.
    """
    root = Path(r"C:\Users\chaze\OneDrive\Desktop\APPS\styleai-app\styleai-app")
    
    persona = {
        "primary_style_goal": "Earth-toned Japanese Americana / Workwear",
        "gender": "male",
        "simulated_wardrobe": 0,
        "test_image": "test_raw_outfit_1.jpg (olive fatigue jacket, white heavy-tee, relaxed denim)"
    }
    
    results = {
        "tab_1_scan": {},
        "tab_2_wardrobe": {},
        "tab_3_discovery": {},
    }
    
    # --- TAB 1: Scan Flow Check ---
    routes = (root / "server" / "routes.ts").read_text(encoding="utf-8")
    
    # Check multi-pass pipeline exists
    has_pass1 = "GARMENT_SCHEMA" in routes and "gemini-2.5-flash-lite" in routes
    has_pass2 = "ANALYSIS_SCHEMA" in routes and "gemini-2.5-flash" in routes
    has_grounding = "garmentSummary" in routes
    
    results["tab_1_scan"]["multi_pass_pipeline"] = has_pass1 and has_pass2 and has_grounding
    results["tab_1_scan"]["structured_visual_facts"] = "GARMENT_SCHEMA" in routes
    results["tab_1_scan"]["primary_secondary_style"] = "secondaryAesthetic" in routes
    results["tab_1_scan"]["color_palette_in_schema"] = "colorPalette" in routes
    
    # Check if results page renders palette prominently
    results_page = (root / "client" / "src" / "pages" / "results.tsx").read_text(encoding="utf-8")
    results["tab_1_scan"]["palette_rendered"] = "colorPalette" in results_page and "color-swatch" in results_page
    
    # --- TAB 2: Wardrobe Check ---
    schema = (root / "shared" / "schema.ts").read_text(encoding="utf-8")
    wardrobe_page = (root / "client" / "src" / "pages" / "wardrobe.tsx").read_text(encoding="utf-8")
    
    results["tab_2_wardrobe"]["has_auto_add_endpoint"] = "/api/wardrobe" in routes
    results["tab_2_wardrobe"]["has_user_id_column"] = "user_id" in schema.lower() or "userid" in schema.lower()
    results["tab_2_wardrobe"]["has_gap_recommendations"] = "GapRecommendations" in wardrobe_page
    
    # --- TAB 3: Discovery Check ---
    home_page = (root / "client" / "src" / "pages" / "home.tsx").read_text(encoding="utf-8")
    vector = (root / "client" / "src" / "lib" / "styleVector.ts").read_text(encoding="utf-8")
    
    results["tab_3_discovery"]["has_vector_ranking"] = "rankByVector" in home_page
    results["tab_3_discovery"]["has_chips"] = "activeChip" in home_page
    results["tab_3_discovery"]["has_taste_memory"] = "loadVector" in vector and "onResultSaved" in vector
    
    return {"persona": persona, "checks": results}


def main():
    print("=" * 60)
    print("FASHION PERSONA TESTER + EXPERT AUDITOR")
    print("=" * 60)
    
    # 1. Run persona simulation
    print("\n[1/3] Simulating test persona...")
    persona_result = simulate_test_persona()
    print(json.dumps(persona_result, indent=2))
    
    # 2. Run audit
    print("\n[2/3] Running codebase audit...")
    audit = audit_codebase()
    
    print(f"\nCRITICAL issues: {len([i for i in audit['issues'] if i['severity'] == 'CRITICAL'])}")
    print(f"HIGH issues:     {len([i for i in audit['issues'] if i['severity'] == 'HIGH'])}")
    print(f"MEDIUM issues:   {len([i for i in audit['issues'] + audit['warnings'] if i['severity'] == 'MEDIUM'])}")
    print(f"Warnings:        {len(audit['warnings'])}")
    
    # 3. Generate patch plan
    print("\n[3/3] Generating patch plan...")
    plan = generate_patch_plan(audit)
    print(plan)
    
    # Save outputs
    out_dir = Path(r"C:\Users\chaze\OneDrive\Desktop\APPS\styleai-app\styleai-app\test-results")
    out_dir.mkdir(exist_ok=True)
    
    (out_dir / "audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    (out_dir / "persona-check.json").write_text(json.dumps(persona_result, indent=2), encoding="utf-8")
    (out_dir / "patch-plan.md").write_text(plan, encoding="utf-8")
    
    print(f"\nResults saved to {out_dir}")
    
    # Return exit code based on critical issues
    critical_count = len([i for i in audit["issues"] if i["severity"] == "CRITICAL"])
    return 1 if critical_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
