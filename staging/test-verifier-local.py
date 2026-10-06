#!/usr/bin/env python3
"""Offline verifier regression: real SQLite schema, mocked Git/Wrangler transport.

No network or Cloudflare commands are run. Remote --file's metadata-only response
is modelled from Wrangler execute.ts; --command executes real read-only SQLite.
Run from the repository root: python3 staging/test-verifier-local.py
"""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_ROOT = ROOT if (ROOT/'migrations').exists() else ROOT/'solectrics---website-main'
SCRIPT = ROOT/'staging/verify-jobhub-staging.sh'
if not SCRIPT.exists(): SCRIPT = ROOT/'review-verify-jobhub-staging.sh'

with tempfile.TemporaryDirectory(prefix='jobhub-verifier-test-') as temp:
    root = Path(temp)
    (root/'staging').mkdir()
    (root/'bin').mkdir()
    for path in (ROOT/'staging').glob('post-0018*.sql'):
        shutil.copy2(path, root/'staging'/path.name)
    fixture = root/'fixture.sqlite'
    db = sqlite3.connect(fixture)
    db.executescript((SCHEMA_ROOT/'staging/pre-0015-baseline.sql').read_text())
    for number in range(15,19):
        files = list((SCHEMA_ROOT/'migrations').glob(f'{number:04}_*.sql'))
        assert len(files)==1
        db.executescript(files[0].read_text())
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")]
    assert len(tables)==43 and 'sqlite_sequence' in tables
    print('Reproduced: 43 SQLite tables = 42 application tables + sqlite_sequence')
    db.close()
    git = root/'bin/git'
    git.write_text('''#!/usr/bin/env python3
import os,sys
a=sys.argv[1:]
if a==['rev-parse','--show-toplevel']: print(os.environ['MOCK_ROOT'])
elif a==['branch','--show-current']: print('codex/jobhub-staging-migrations-0015-0018')
elif a and a[0]=='rev-parse': print('a'*40)
elif a[0] not in ['fetch','diff','cat-file']: sys.exit(1)
''')
    npx = root/'bin/npx'
    npx.write_text('''#!/usr/bin/env python3
import os,sys,json,pathlib,sqlite3
a=sys.argv[1:]
with open(os.environ['MOCK_LOG'],'a') as f: f.write(json.dumps(a)+'\\n')
uid='11111111-1111-1111-1111-111111111111'
if a==['wrangler','d1','list','--json']:
    print(json.dumps([{'name':'jobhub-staging','uuid':uid}]))
elif a[:3]==['wrangler','d1','info']:
    assert a[3]=='jobhub-staging'
    print(json.dumps({'name':'jobhub-staging','uuid':uid}))
elif a[:3]==['wrangler','d1','execute']:
    assert a[3]=='jobhub-staging'
    cfg=pathlib.Path(a[a.index('--config')+1]).read_text()
    assert 'database_name = "jobhub-staging"' in cfg and uid in cfg
    db=sqlite3.connect('file:'+os.environ['MOCK_DB']+'?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    # Model D1's rejection of full integrity_check, including table-valued use.
    db.set_authorizer(lambda action,arg1,arg2,dbname,origin: sqlite3.SQLITE_DENY if action==sqlite3.SQLITE_PRAGMA and arg1=='integrity_check' else sqlite3.SQLITE_OK)
    if '--file' in a:
        sql=pathlib.Path(a[a.index('--file')+1]).read_text()
        db.execute(sql).fetchall()
        print(json.dumps([{'success':True,'results':[{'Total queries executed':1,'Rows written':0}],'meta':{'num_tables':43}}]))
    else:
        assert '--command' in a
        sql=a[a.index('--command')+1]
        if sql.strip()=='PRAGMA quick_check;\\nPRAGMA foreign_key_check;':
            results=[]
            for query in ['PRAGMA quick_check','PRAGMA foreign_key_check']:
                rows=[dict(row) for row in db.execute(query)]
                if query=='PRAGMA quick_check' and os.environ.get('MOCK_BAD_INTEGRITY')=='quick':
                    rows=[{'quick_check':'simulated corruption'}]
                if query=='PRAGMA foreign_key_check' and os.environ.get('MOCK_BAD_INTEGRITY')=='fk':
                    rows=[{'table':'jobs','rowid':1,'parent':'enquiries','fkid':0}]
                results.append({'success':True,'results':rows,'meta':{'rows_written':0}})
            print(json.dumps(results))
        else:
            rows=[dict(row) for row in db.execute(sql)]
            print(json.dumps([{'success':True,'results':rows,'meta':{'rows_written':0,'num_tables':43}}]))
else: raise Exception('Unexpected command')
''')
    git.chmod(0o755); npx.chmod(0o755)
    log=root/'commands.jsonl'
    env=dict(os.environ, PATH=str(root/'bin')+':'+os.environ['PATH'],MOCK_ROOT=str(root),MOCK_LOG=str(log),MOCK_DB=str(fixture))
    target=root/'staging/verify-jobhub-staging.sh'

    def run(source, success, label):
        target.write_text(source.read_text())
        log.write_text('')
        result=subprocess.run(['bash',str(target)],cwd=root,env=env,text=True,capture_output=True)
        output=result.stdout+result.stderr
        assert (result.returncode==0)==success, output
        if success:
            assert 'PASS: actual jobhub-staging schema' in output
            assert 'SQLITE_INTERNAL' in output
            calls=[json.loads(line) for line in log.read_text().splitlines()]
            queries=[a for a in calls if a[:3]==['wrangler','d1','execute']]
            assert len(queries)==8
            assert all('--command' in a and '--file' not in a for a in queries)
        print(label+': PASS')
        return output

    old=ROOT/'review-original-verifier.sh'
    if old.exists():
        out=run(old,False,'Original --file failure reproduced')
        assert 'num_tables' in out and 'JOBHUB_VERIFY_OK:objects' not in out
    run(SCRIPT,True,'Corrected full verifier against 43-table schema')
    db=sqlite3.connect(fixture)
    db.execute('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TEXT)')
    db.commit(); db.close()
    run(SCRIPT,True,'Corrected verifier with Wrangler migration-history table')
    for failure in ['quick','fk']:
        env['MOCK_BAD_INTEGRITY']=failure
        run(SCRIPT,False,'Rejected failed D1 integrity check: '+failure)
    env.pop('MOCK_BAD_INTEGRITY')
    db=sqlite3.connect(fixture)
    db.execute('CREATE TABLE unexpected_application_table(id INTEGER)')
    db.commit(); db.close()
    out=run(SCRIPT,False,'Unexpected application table correctly rejected')
    assert 'UNEXPECTED_TABLE:unexpected_application_table' in out
    db=sqlite3.connect(fixture)
    db.execute('DROP TABLE unexpected_application_table')
    db.execute('ALTER TABLE jobs ADD COLUMN unexpected_column TEXT')
    db.commit(); db.close()
    out=run(SCRIPT,False,'Unexpected application column correctly rejected')
    assert 'COLUMN_COUNT:jobs' in out
    db=sqlite3.connect(fixture)
    db.execute('ALTER TABLE jobs DROP COLUMN unexpected_column')
    db.execute('DROP INDEX idx_jobs_supplier_reference_unique')
    db.commit(); db.close()
    out=run(SCRIPT,False,'Missing explicit index correctly rejected')
    assert 'MISSING_OR_MISMATCHED_INDEX:idx_jobs_supplier_reference_unique' in out
print('All offline checks passed; no Cloudflare access.')
