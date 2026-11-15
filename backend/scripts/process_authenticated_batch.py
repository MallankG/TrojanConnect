import json
import os
import re
from datetime import datetime

AUTHENTICATED_DIR = "backend/app/repositories/seed/authenticated"
CLUBS_FILE = os.path.join(AUTHENTICATED_DIR, "clubs.json")
EVENTS_FILE = os.path.join(AUTHENTICATED_DIR, "events.json")

def load_existing():
    clubs = []
    events = []
    if os.path.exists(CLUBS_FILE):
        with open(CLUBS_FILE, "r") as f:
            clubs = json.load(f)
    if os.path.exists(EVENTS_FILE):
        with open(EVENTS_FILE, "r") as f:
            events = json.load(f)
    return clubs, events

def save(clubs, events):
    os.makedirs(AUTHENTICATED_DIR, exist_ok=True)
    with open(CLUBS_FILE, "w") as f:
        json.dump(clubs, f, indent=2)
    with open(EVENTS_FILE, "w") as f:
        json.dump(events, f, indent=2)
    print(f"Incremental save: {len(clubs)} clubs, {len(events)} events written to {AUTHENTICATED_DIR}")

def clean_text(text, max_len=None):
    if not text:
        return ""
    # Remove excess whitespace
    cleaned = re.sub(r'\s+', ' ', text).strip()
    if max_len and len(cleaned) > max_len:
        cleaned = cleaned[:max_len-3] + "..."
    return cleaned

def process_batch(batch_items, all_events_raw):
    clubs, events = load_existing()
    existing_org_ids = {c["organization_id"] for c in clubs}
    existing_event_keys = {(e["organization_id"], e["title"], e["start_at"]) for e in events}
    
    # Load 53 public clubs for base data
    public_clubs_map = {}
    if os.path.exists("backend/app/repositories/seed/real/clubs.json"):
        with open("backend/app/repositories/seed/real/clubs.json", "r") as f:
            for pc in json.load(f):
                public_clubs_map[pc["slug"]] = pc
                
    for item in batch_items:
        org_id = item["organization_id"]
        slug = item["slug"]
        name = item["name"]
        
        base_pub = public_clubs_map.get(slug, {})
        engage = item.get("engageData") or {}
        home = item.get("homeData") or {}
        
        # Category
        raw_cat = engage.get("category") or base_pub.get("category", "Student Organization")
        cat_clean = clean_text(raw_cat.split('\n')[0].replace("Recognized Student Organization (RSO)", "").strip(" -,"), 60) or "Student Organization"
        
        # Tags
        tags = base_pub.get("tags", [])
        if not tags:
            tags = [t.strip().lower() for t in re.split(r'[,/]', cat_clean) if t.strip()]
        tags = tags[:20]
        
        # Mission / Description
        mission = clean_text(engage.get("mission", ""))
        if mission.lower().startswith("mission"):
            mission = mission[7:].strip()
        pub_desc = mission if mission else base_pub.get("public_description", "")
        pub_desc = clean_text(pub_desc, 2000)
        
        # Membership Benefits
        benefits = clean_text(engage.get("benefits", ""))
        if benefits.lower().startswith("membership benefits"):
            benefits = benefits[19:].strip()
            
        # Dues / Duration
        dues_dur = clean_text(engage.get("duesDuration", ""))
        
        # Recruitment Status: "open", "application", "closed", "unknown"
        rec_status = engage.get("recruitmentStatus")
        if rec_status not in ["open", "application", "closed"]:
            rec_status = base_pub.get("recruitment_status", "unknown")
        if rec_status not in ["open", "application", "closed", "unknown"]:
            rec_status = "unknown"
            
        # Membership requirements
        reqs = base_pub.get("membership_requirements", "")
        if dues_dur:
            reqs = f"{reqs} Dues/Duration: {dues_dur}".strip()
        reqs = clean_text(reqs, 600)
        
        # How to join
        how_to_join = base_pub.get("how_to_join", "")
        if rec_status == "closed":
            how_to_join = clean_text(f"Membership is currently closed on EngageSC. {how_to_join}", 600)
        elif rec_status == "open":
            how_to_join = clean_text(f"Open membership via EngageSC. {how_to_join}", 600)
        elif benefits and not how_to_join:
            how_to_join = clean_text(benefits, 600)
            
        # Public contact / Shared email
        shared_email = home.get("shared_email") or ""
        public_contact = shared_email if shared_email else base_pub.get("public_contact", "")
        public_contact = clean_text(public_contact, 200)
        
        # Website
        website = engage.get("website") or base_pub.get("website", "")
        website = clean_text(website, 300)
        
        # Social links
        social_links = dict(base_pub.get("social_links", {}))
        if home.get("social_links"):
            for k, v in home["social_links"].items():
                if v:
                    social_links[k] = v
                    
        # Source urls
        source_urls = list(item.get("source_urls", []))
        for u in base_pub.get("source_urls", []):
            if u not in source_urls:
                source_urls.append(u)
        source_urls = source_urls[:20]
        
        # Activities & Notable events
        activities = base_pub.get("activities", [])
        if benefits and not activities:
            activities = [clean_text(b, 100) for b in re.split(r'[–-•;]', benefits) if len(b.strip()) > 5][:20]
            
        notable_events = base_pub.get("notable_events", [])
        
        club_profile = {
            "organization_id": org_id,
            "name": clean_text(name, 120),
            "slug": clean_text(slug, 120),
            "category": cat_clean,
            "tags": tags,
            "public_description": pub_desc,
            "history": clean_text(base_pub.get("history", ""), 4000),
            "founded_year": base_pub.get("founded_year"),
            "activities": activities,
            "notable_events": notable_events,
            "meeting_schedule": clean_text(base_pub.get("meeting_schedule", ""), 300),
            "time_commitment": clean_text(base_pub.get("time_commitment", ""), 300),
            "time_commitment_hours_per_week": base_pub.get("time_commitment_hours_per_week"),
            "membership_requirements": reqs,
            "recruitment_status": rec_status,
            "how_to_join": how_to_join,
            "who_thrives_here": clean_text(base_pub.get("who_thrives_here", ""), 600),
            "faq": base_pub.get("faq", []),
            "public_contact": public_contact,
            "verification_status": "unverified",
            "data_label": "engage_authenticated",
            "website": website,
            "social_links": social_links,
            "source_urls": source_urls,
            "collected_at": "2026-11-14"
        }
        
        # Add or update in clubs
        if org_id in existing_org_ids:
            for i, c in enumerate(clubs):
                if c["organization_id"] == org_id:
                    clubs[i] = club_profile
                    break
        else:
            clubs.append(club_profile)
            existing_org_ids.add(org_id)
            
        # Match events
        club_id = engage.get("clubId")
        for ev in all_events_raw:
            ev_club_id = ev.get("club_id")
            ev_club_slug = (ev.get("club_slug") or "").lower()
            ev_club_name = (ev.get("club_name") or "").lower()
            
            is_match = False
            if club_id and ev_club_id == club_id:
                is_match = True
            elif slug.lower() in ev_club_slug or ev_club_slug in slug.lower():
                is_match = True
            elif name.lower() in ev_club_name or ev_club_name in name.lower():
                is_match = True
                
            if is_match:
                title = clean_text(ev.get("title", ""), 200)
                desc = clean_text(ev.get("details_text", ""), 2000)
                location = clean_text(ev.get("location", ""), 200)
                
                # Parse date times: e.g. Mon, Aug 24, 2026 1:00 PM
                dates_html = ev.get("dates_html", "")
                # Default timestamps if not cleanly parseable
                start_iso = "2026-08-24T13:00:00-07:00"
                end_iso = "2026-12-19T13:00:00-07:00"
                
                # Try regex matching date strings
                date_matches = re.findall(r'([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)', dates_html)
                if len(date_matches) >= 1:
                    try:
                        dt1 = datetime.strptime(date_matches[0], "%a, %b %d, %Y %I:%M %p")
                        start_iso = dt1.strftime("%Y-%m-%dT%H:%M:%S-07:00")
                    except Exception:
                        pass
                if len(date_matches) >= 2:
                    try:
                        dt2 = datetime.strptime(date_matches[1], "%a, %b %d, %Y %I:%M %p")
                        end_iso = dt2.strftime("%Y-%m-%dT%H:%M:%S-07:00")
                    except Exception:
                        pass
                        
                event_key = (org_id, title, start_iso)
                if event_key not in existing_event_keys:
                    events.append({
                        "organization_id": org_id,
                        "title": title,
                        "description": desc,
                        "start_at": start_iso,
                        "end_at": end_iso,
                        "location": location,
                        "visibility": "public"
                    })
                    existing_event_keys.add(event_key)
                    
    save(clubs, events)
    return len(clubs), len(events)
