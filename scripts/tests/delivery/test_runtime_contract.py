"""Bind executable worker and provider assets through real Linux paths."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(
    sys.platform == "linux" and shutil.which("node"),
    "Linux procfd traversal and Node are required for the executable contract",
)
class RollingContractTests(unittest.TestCase):
    directory: tempfile.TemporaryDirectory[str]
    root: Path
    source: str

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(
            prefix="sotto-rolling-contract-"
        )
        self.root = Path(self.directory.name)
        paths = [
            "apps/web/src/lib/providers/base.ts",
            "apps/web/prisma/schema.prisma",
            "apps/web/src/lib/sidedoor/authority.ts",
            "apps/web/src/lib/queue.ts",
            "apps/web/src/lib/redis.ts",
            "apps/web/src/workers/index.ts",
            "node_modules/.package-lock.json",
            "packages/shared/src/contracts.ts",
            "packages/learning-model/src/lesson.ts",
        ]
        for name in ["thesidedoor", "thesidedoor-core"]:
            paths.extend(
                [
                    f"node_modules/{name}/package.json",
                    f"node_modules/{name}/dist/index.js",
                ]
            )
        paths.extend(
            f"node_modules/thesidedoor-flock/{name}"
            for name in [
                "package.json",
                "index.cjs",
                "binding.gyp",
                "fs-ext.cc",
            ]
        )
        for path in paths:
            self.write(path, f"fixture payload {path}\n")
        source = (
            ROOT / "scripts/deploy/checks/rolling-contract.cjs"
        ).read_text()
        self.assertEqual(source.count("'/app'"), 1)
        self.source = source.replace("'/app'", json.dumps(str(self.root)))

    def tearDown(self) -> None:
        self.directory.cleanup()

    def write(self, relative: str, content: str) -> None:
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def contract(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["node", "-e", self.source],
            capture_output=True,
            text=True,
            check=False,
        )

    def digest(self) -> str:
        result = self.contract()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"^[a-f0-9]{64}\n$")
        return result.stdout

    def runtime_assets(self) -> subprocess.CompletedProcess[str]:
        source = (
            ROOT / "scripts/deploy/runtime/provider-assets.cjs"
        ).read_text()
        self.assertEqual(source.count("'/app'"), 1)
        source = source.replace("'/app'", json.dumps(str(self.root)))
        return subprocess.run(
            ["node", "-e", source], capture_output=True, text=True, check=False
        )

    def test_play_maintenance_and_authority_change_both_runtime_proofs(
        self,
    ) -> None:
        before_contract = self.digest()
        result = self.runtime_assets()
        self.assertEqual(result.returncode, 0, result.stderr)
        before_assets = json.loads(result.stdout)
        for name, content in (
            (
                "apps/web/src/lib/play/storage/maintenance.ts",
                "original maintenance\n",
            ),
            (
                "apps/web/src/lib/play/storage/maintenance.ts",
                "changed maintenance\n",
            ),
            ("apps/web/src/lib/play/new-authority.ts", "new authority\n"),
        ):
            with self.subTest(asset=name, content=content):
                self.write(name, content)
                changed_contract = self.digest()
                result = self.runtime_assets()
                self.assertEqual(result.returncode, 0, result.stderr)
                changed_assets = json.loads(result.stdout)
                self.assertNotEqual(changed_contract, before_contract)
                self.assertNotEqual(
                    changed_assets["protectedHash"],
                    before_assets["protectedHash"],
                )
                self.assertEqual(
                    changed_assets["files"][name],
                    hashlib.sha256(content.encode()).hexdigest(),
                )
                before_contract, before_assets = (
                    changed_contract,
                    changed_assets,
                )

    def test_play_root_symlink_refuses_both_runtime_proofs(self) -> None:
        target = self.root / "apps/web/src/lib/play"
        target.symlink_to(
            self.root / "apps/web/src/lib/sidedoor", target_is_directory=True
        )
        for result in (self.contract(), self.runtime_assets()):
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")

    def test_nested_play_symlink_refuses_both_runtime_proofs(self) -> None:
        name = "apps/web/src/lib/play/storage/maintenance.ts"
        self.write(name, "owned maintenance\n")
        target = self.root / name
        target.unlink()
        target.symlink_to(self.root / "apps/web/src/lib/queue.ts")
        for result in (self.contract(), self.runtime_assets()):
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")

    def test_same_payload_matches_without_requiring_nonexistent_flock_dist(
        self,
    ) -> None:
        before = self.digest()
        self.assertFalse(
            (self.root / "node_modules/thesidedoor-flock/dist").exists()
        )
        self.assertEqual(self.digest(), before)

    def test_provider_inventory_names_every_changed_and_retained_runtime_file(
        self,
    ) -> None:
        self.write("apps/web/src/lib/providers/fish.ts", "original provider\n")
        self.write("apps/web/prisma/schema.prisma", "original schema\n")
        source = (
            ROOT / "scripts/deploy/runtime/provider-assets.cjs"
        ).read_text()
        source = source.replace("'/app'", json.dumps(str(self.root)))
        first = subprocess.run(
            ["node", "-e", source], capture_output=True, text=True
        )
        self.assertEqual(first.returncode, 0, first.stderr)
        before = json.loads(first.stdout)
        self.assertEqual(
            before["files"]["apps/web/src/lib/providers/fish.ts"],
            hashlib.sha256(b"original provider\n").hexdigest(),
        )
        self.assertIn(
            "node_modules/thesidedoor-flock/index.cjs", before["files"]
        )
        self.write("apps/web/src/lib/providers/fish.ts", "changed provider\n")
        second = subprocess.run(
            ["node", "-e", source], capture_output=True, text=True
        )
        self.assertEqual(second.returncode, 0, second.stderr)
        after = json.loads(second.stdout)
        self.assertNotEqual(before["protectedHash"], after["protectedHash"])
        self.assertEqual(
            {
                name
                for name in before["files"]
                if before["files"][name] != after["files"][name]
            },
            {"apps/web/src/lib/providers/fish.ts"},
        )
        target = self.root / "apps/web/src/lib/providers/fish.ts"
        target.unlink()
        target.symlink_to(self.root / "apps/web/src/lib/queue.ts")
        self.assertNotEqual(
            subprocess.run(
                ["node", "-e", source], capture_output=True
            ).returncode,
            0,
        )

    def test_pdf_renderer_changes_are_bound_to_contract_and_inventory(
        self,
    ) -> None:
        before = self.digest()
        self.write(
            "apps/web/src/lib/providers/documents/process.ts",
            "owned renderer process\n",
        )
        helper = "apps/web/scripts/pdf-render/render-worker.mjs"
        self.write(helper, "original renderer\n")
        added = self.digest()
        self.assertNotEqual(added, before)
        source = (
            ROOT / "scripts/deploy/runtime/provider-assets.cjs"
        ).read_text()
        source = source.replace("'/app'", json.dumps(str(self.root)))
        self.write("apps/web/prisma/schema.prisma", "unchanged schema\n")
        inventory = subprocess.run(
            ["node", "-e", source], capture_output=True, text=True
        )
        self.assertEqual(inventory.returncode, 0, inventory.stderr)
        self.assertEqual(
            json.loads(inventory.stdout)["files"][helper],
            hashlib.sha256(b"original renderer\n").hexdigest(),
        )
        self.write(helper, "changed renderer\n")
        self.assertNotEqual(self.digest(), added)

    def test_changed_payload_or_added_authority_changes_the_contract(
        self,
    ) -> None:
        before = self.digest()
        self.write("apps/web/src/lib/queue.ts", "changed queue contract\n")
        changed = self.digest()
        self.assertNotEqual(changed, before)
        self.write(
            "apps/web/src/lib/sidedoor/new-authority.ts", "new authority\n"
        )
        authority = self.digest()
        self.assertNotEqual(authority, changed)
        self.write(
            "apps/web/src/workers/index.ts", "changed worker executable\n"
        )
        worker = self.digest()
        self.assertNotEqual(worker, authority)
        self.write(
            "node_modules/.package-lock.json",
            "changed installed dependency identity\n",
        )
        self.assertNotEqual(self.digest(), worker)

    def test_missing_executable_payload_rejects_the_contract(self) -> None:
        (self.root / "node_modules/thesidedoor-core/dist/index.js").unlink()
        result = self.contract()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_workspace_packages_and_core_local_flock_match_runtime_resolution(
        self,
    ) -> None:
        before = self.digest()
        for name in ["thesidedoor", "thesidedoor-core"]:
            target = self.root / "apps/web/node_modules" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(self.root / "node_modules" / name), target)
        core = "apps/web/node_modules/thesidedoor-core"
        target = self.root / core / "node_modules/thesidedoor-flock"
        target.parent.mkdir(parents=True)
        shutil.move(str(self.root / "node_modules/thesidedoor-flock"), target)
        workspace = self.digest()
        self.assertNotEqual(workspace, before)
        self.write(
            "node_modules/thesidedoor-flock/index.cjs", "shadowed flock"
        )
        self.assertEqual(self.digest(), workspace)
        self.write(
            core + "/node_modules/thesidedoor-flock/index.cjs",
            "changed selected native lock implementation",
        )
        self.assertNotEqual(self.digest(), workspace)

    def test_symlinked_or_incomplete_workspace_package_cannot_use_root_copy(
        self,
    ) -> None:
        target = self.root / "apps/web/node_modules/thesidedoor-core"
        target.parent.mkdir(parents=True)
        target.symlink_to(self.root / "node_modules/thesidedoor-core")
        self.assertNotEqual(self.contract().returncode, 0)
        target.unlink()
        target.mkdir()
        self.assertNotEqual(self.contract().returncode, 0)

    def test_symlinked_authority_rejects_the_contract(self) -> None:
        target = self.root / "apps/web/src/lib/sidedoor/authority.ts"
        target.unlink()
        target.symlink_to(self.root / "apps/web/src/lib/queue.ts")
        result = self.contract()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_replaced_authority_path_reads_the_original_open_file(
        self,
    ) -> None:
        before = self.digest()
        target = self.root / "apps/web/src/lib/sidedoor/authority.ts"
        outside = self.root / "outside-authority.ts"
        outside.write_text(
            "malicious authority outside the executable contract\n"
        )
        self.source = (
            """(() => {
  const boundary = require('node:fs');
  const originalRead = boundary.readFileSync;
  const target = %s;
  boundary.readFileSync = function (input, ...options) {
    const actual = typeof input === 'number'
      ? boundary.readlinkSync('/proc/self/fd/' + input) : String(input);
    if (actual === target && !boundary.lstatSync(target).isSymbolicLink()) {
      boundary.unlinkSync(target);
      boundary.symlinkSync(%s, target);
    }
    return originalRead.call(this, input, ...options);
  };
})();
"""
            % (json.dumps(str(target)), json.dumps(str(outside)))
            + self.source
        )
        self.assertEqual(self.digest(), before)
        self.assertTrue(target.is_symlink())
        self.assertEqual(target.resolve(), outside)
        self.assertEqual(target.read_text(), outside.read_text())

    def test_replaced_directory_enumerates_original_open_directory(
        self,
    ) -> None:
        before = self.digest()
        target = self.root / "apps/web/src/lib/sidedoor"
        retained = self.root / "original-authority-directory"
        outside = self.root / "outside-authority-directory"
        outside.mkdir()
        (outside / "authority.ts").write_text(
            "malicious replacement authority\n"
        )
        self.source = (
            """(() => {
  const boundary = require('node:fs');
  const originalRead = boundary.readdirSync;
  const target = %s;
  boundary.readdirSync = function (input, ...options) {
    const actual = typeof input === 'number'
      ? boundary.readlinkSync('/proc/self/fd/' + input)
      : String(input).startsWith('/proc/self/fd/')
        ? boundary.readlinkSync(String(input)) : String(input);
    if (actual === target && !boundary.lstatSync(target).isSymbolicLink()) {
      boundary.renameSync(target, %s);
      boundary.symlinkSync(%s, target);
    }
    return originalRead.call(this, input, ...options);
  };
})();
"""
            % (
                json.dumps(str(target)),
                json.dumps(str(retained)),
                json.dumps(str(outside)),
            )
            + self.source
        )
        self.assertEqual(self.digest(), before)
        self.assertTrue(target.is_symlink())
        self.assertEqual(target.resolve(), outside)
        self.assertEqual(
            (retained / "authority.ts").read_text(),
            "fixture payload apps/web/src/lib/sidedoor/authority.ts\n",
        )
