#!/usr/bin/env python3
"""Fail-closed staging identity/config checks. No network calls."""
import json
import re
import sys
import tomllib
from pathlib import Path

PROJECT = "solectrics-jobhub-staging"
DATABASE = "jobhub-staging"
BUCKET = "jobhub-files-staging"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

def identity(rows):
    if not isinstance(rows, list) or any(not isinstance(r, dict) or not isinstance(r.get("name"),str) or not isinstance(r.get("uuid"),str) for r in rows):
        raise ValueError("Incomplete D1 account metadata")
    matches = [r for r in rows if r["name"] == DATABASE]
    if len(matches) != 1:
        raise ValueError("Expected exactly one database named jobhub-staging")
    selected = matches[0]["uuid"].lower()
    if not UUID.fullmatch(selected) or len([r for r in rows if r["uuid"].lower() == selected]) != 1:
        raise ValueError("Staging UUID is invalid or ambiguous")
    return selected

def info(value, selected):
    if not UUID.fullmatch(selected) or not isinstance(value, dict) or value.get("name") != DATABASE or str(value.get("uuid","")).lower() != selected.lower():
        raise ValueError("D1 info does not confirm the exact jobhub-staging name/UUID")

def pages(config, selected):
    if config.get("name") != PROJECT or not UUID.fullmatch(selected):
        raise ValueError("Wrong staging Pages project or invalid UUID")
    # Downloaded Wrangler settings use Preview at top level and Production
    # overrides. Arrays/vars are non-inheritable: an explicit override wins.
    production = config.get("env", {}).get("production", {})
    if not isinstance(production, dict):
        raise ValueError("Invalid Production environment")
    effective = {**config, **production}
    databases = effective.get("d1_databases", [])
    buckets = effective.get("r2_buckets", [])
    if len(databases) != 1 or databases[0].get("binding") != "DB" or str(databases[0].get("database_id","")).lower() != selected.lower():
        raise ValueError("Staging Pages DB binding does not match verified jobhub-staging UUID")
    # Wrangler download assigns database_name=DB (binding alias), not the real
    # name; identity is established through D1 list + D1 info, never this alias.
    if databases[0].get("database_name") not in (DATABASE, "DB"):
        raise ValueError("Unexpected downloaded D1 name")
    if len(buckets) != 1 or buckets[0].get("binding") != "JOB_FILES" or buckets[0].get("bucket_name") != BUCKET:
        raise ValueError("Staging Pages JOB_FILES binding is not exactly jobhub-files-staging")
    if effective.get("vars", {}).get("ALLOW_PAGES_DEV_HOST") != "true":
        raise ValueError("Staging hostname setting is missing")
    for key in ("services","kv_namespaces","durable_objects","queues","analytics_engine_datasets","ai","vectorize","hyperdrive"):
        if effective.get(key):
            raise ValueError("Unexpected extra binding: " + key)
    date = effective.get("compatibility_date")
    if not isinstance(date,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",date):
        raise ValueError("Missing explicit compatibility date")
    flags = effective.get("compatibility_flags", [])
    if not isinstance(flags,list) or any(not isinstance(x,str) for x in flags):
        raise ValueError("Invalid compatibility flags")
    # Output contains only staging resources and the hostname variable. No
    # secrets, extra dashboard vars or preview resources are copied.
    return {
        "name": PROJECT, "pages_build_output_dir": "./public",
        "compatibility_date": date, "compatibility_flags": flags,
        "vars": {"ALLOW_PAGES_DEV_HOST": "true", "JOBHUB_STAGING_ONLY": "true"},
        "d1_databases": [{"binding":"DB","database_name":DATABASE,"database_id":selected.lower()}],
        "r2_buckets": [{"binding":"JOB_FILES","bucket_name":BUCKET}]
    }

if __name__ == "__main__":
    try:
        mode, file, *args = sys.argv[1:]
        if mode == "identity":
            print(identity(json.loads(Path(file).read_text())))
        elif mode == "info":
            info(json.loads(Path(file).read_text()), args[0])
        elif mode == "pages":
            value = pages(tomllib.loads(Path(file).read_text()),args[0])
            Path(args[1]).write_text(json.dumps(value,indent=2)+"\n")
        else:
            raise ValueError("Unknown check mode")
    except Exception as error:
        print("STOP: "+str(error),file=sys.stderr)
        sys.exit(1)
