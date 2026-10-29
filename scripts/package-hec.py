"""Prepare public static assets only; Pages compiles repository-root functions/ separately."""
from pathlib import Path
import subprocess,shutil,sys
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1] if len(sys.argv)>1 else root/'dist').resolve()
if out==root or root.is_relative_to(out):raise SystemExit('Output must not contain the repository')
if out.exists() and any(out.iterdir()):raise SystemExit('Output is not empty; choose a fresh directory')
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
for name in files:
 p=Path(name)
 if not name or not ((len(p.parts)==1 and p.suffix in ['.html','.png','.ico']) or p.parts[0]=='assets'):continue
 target=out/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/p,target)
print('Static assets packaged. functions/ must be compiled separately by Pages; never serve it as static content.')
