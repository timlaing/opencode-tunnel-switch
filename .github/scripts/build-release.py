"""Build an explicit, credential-free install bundle from this checkout."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="tunnel-switch-release-") as work:
    work = Path(work)
    stage = work / "opencode-tunnel-switch"
    service = stage / "service"
    service.mkdir(parents=True)
    subprocess.run([sys.executable, "-m", "build", "--outdir", str(service)], cwd=ROOT, check=True)
    packed = work / "packed"
    packed.mkdir()
    result = subprocess.run(["npm", "pack", "--json", "--pack-destination", str(packed),
                             "--cache", str(work / "npm-cache")],
                            cwd=ROOT / "plugin", check=True, capture_output=True, text=True)
    manifest = json.loads(result.stdout)
    archive = packed / manifest[0]["filename"]
    manifest[0]["filename"] = str(archive)
    pack_json = work / "pack.json"
    pack_json.write_text(json.dumps(manifest))
    subprocess.run(["bun", "scripts/verify-package.ts", str(pack_json)], cwd=ROOT / "plugin", check=True)
    with tarfile.open(archive) as bundle:
        bundle.extractall(stage / "unpacked", filter="data")
    (stage / "unpacked/package").rename(stage / "plugin")
    (stage / "unpacked").rmdir()
    for name in ("README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", "LICENSE"):
        shutil.copyfile(ROOT / name, stage / name)
    shutil.copytree(ROOT / "docs", stage / "docs")
    shutil.copytree(ROOT / "deploy", stage / "deploy")
    shutil.copytree(ROOT / "examples", stage / "examples")
    versions = {
        "plugin": json.loads((ROOT / "plugin/package.json").read_text())["version"],
        "service_wheel": next(service.glob("*.whl")).name,
    }
    (stage / "versions.json").write_text(json.dumps(versions, indent=2) + "\n")
    target = output / "opencode-tunnel-switch-release.tar.gz"
    with tarfile.open(target, "w:gz") as bundle:
        bundle.add(stage, arcname=stage.name)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text(f"{digest}  {target.name}\n")
    print(f"Built {target.name}: {versions}")
