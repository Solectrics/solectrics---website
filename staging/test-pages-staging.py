#!/usr/bin/env python3
"""Offline deployment guard tests: no real Wrangler or Cloudflare calls."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("guard",ROOT/"staging/check-pages-staging.py")
guard=importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
ID="11111111-1111-1111-1111-111111111111"
BASE={
 "name":guard.PROJECT,"compatibility_date":"2026-10-05",
 "env":{"production":{
  "vars":{"ALLOW_PAGES_DEV_HOST":"true"},
  "d1_databases":[{"binding":"DB","database_name":"DB","database_id":ID}],
  "r2_buckets":[{"binding":"JOB_FILES","bucket_name":guard.BUCKET}]
 }}
}

class Guards(unittest.TestCase):
 def test_duplicate_names_or_uuids_fail(self):
  row={"name":guard.DATABASE,"uuid":ID}
  self.assertEqual(guard.identity([row]),ID)
  for rows in ([],[row,row],[row,{"name":"other","uuid":ID}]):
   with self.assertRaises(ValueError): guard.identity(rows)
 def test_info_requires_exact_name_uuid(self):
  guard.info({"name":guard.DATABASE,"uuid":ID},ID)
  for value in ({"name":"solectrics-enquiries","uuid":ID},{"name":guard.DATABASE,"uuid":"22222222-2222-2222-2222-222222222222"}):
   with self.assertRaises(ValueError): guard.info(value,ID)
 def test_only_staging_resources_in_output(self):
  value=guard.pages(BASE,ID)
  self.assertEqual(value["d1_databases"][0]["database_name"],guard.DATABASE)
  self.assertEqual(value["r2_buckets"][0]["bucket_name"],guard.BUCKET)
  self.assertNotIn("env",value)
 def test_wrong_bindings_and_hostname_fail(self):
  for field,value in (
   ("d1_databases",[{"binding":"DB","database_id":"22222222-2222-2222-2222-222222222222"}]),
   ("r2_buckets",[{"binding":"JOB_FILES","bucket_name":"solectrics-job-files"}]),
   ("services",[{"binding":"LIVE","service":"other"}]),("vars",{})):
   config=json.loads(json.dumps(BASE))
   config["env"]["production"][field]=value
   with self.assertRaises(ValueError): guard.pages(config,ID)

if __name__=="__main__":
 unittest.main()
