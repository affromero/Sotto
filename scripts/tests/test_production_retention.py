import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("retention", pathlib.Path(__file__).parents[1] / "deploy" / "production-retention.py")
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        self.images = {name: "sha256:" + character * 64 for name, character in (("web", "a"), ("workers", "b"), ("old", "c"), ("historic", "d"))}
        self.environment = {"SOTTO_STACK": "sotto", "RETENTION_ATTEMPT_KEY": "test", "PRODUCTION_IMAGE_RETENTION_DIR": str(self.root), "SOTTO_WEB_IMAGE_REF": "web", "SOTTO_WORKERS_IMAGE_REF": "workers"}

    def docker_output(self, arguments, **kwargs):
        if arguments[1:3] == ["image", "inspect"]:
            return self.images[arguments[-1]]
        if arguments[1] == "ps":
            return "old-container" if arguments[-1].endswith("=sotto-blue") else ""
        return self.images["old"]

    def test_failure_preserves_existing_and_incoming_images(self):
        stable = {"protected_images": [self.images["historic"]]}
        (self.root / "sotto.json").write_text(json.dumps(stable))
        with patch("subprocess.check_output", side_effect=self.docker_output):
            retention.update_record("begin", self.environment)
        attempt = json.loads((self.root / "sotto-attempt-test.json").read_text())
        self.assertEqual(set(attempt["protected_images"]), set(self.images.values()))
        self.assertEqual(json.loads((self.root / "sotto.json").read_text()), stable)

    def test_success_rotates_only_this_attempt_and_keeps_previous_failures(self):
        failed = self.root / "sotto-attempt-failed.json"
        failed.write_text(json.dumps({"protected_images": [self.images["historic"]]}))
        (self.root / "sotto.json").write_text(json.dumps({"protected_images": [self.images["historic"]]}))
        with patch("subprocess.check_output", side_effect=self.docker_output):
            retention.update_record("begin", self.environment)
        retention.update_record("success", self.environment)
        current = json.loads((self.root / "sotto.json").read_text())["protected_images"]
        self.assertEqual(set(current), {self.images[name] for name in ("web", "workers", "old")})
        self.assertTrue(failed.exists())
        self.assertFalse((self.root / "sotto-attempt-test.json").exists())

    def test_invalid_docker_identity_leaves_stable_record_untouched(self):
        stable = {"protected_images": [self.images["historic"]]}
        (self.root / "sotto.json").write_text(json.dumps(stable))
        with patch("subprocess.check_output", return_value="invalid"), self.assertRaises(ValueError):
            retention.update_record("begin", self.environment)
        self.assertEqual(json.loads((self.root / "sotto.json").read_text()), stable)
        self.assertFalse((self.root / "sotto-attempt-test.json").exists())

    def test_record_names_cannot_escape_the_retention_directory(self):
        with self.assertRaises(ValueError):
            retention.update_record("begin", {**self.environment, "SOTTO_STACK": "../other"})

    def test_backup_cleanup_keeps_newest_recent_failed_unknown_and_symlinked_files(self):
        now = 100 * 86400
        sha = 'a' * 40
        digest = 'b' * 64
        def backup(key, timestamp=None):
            path = self.root / (sha + '-' + key + '.dump')
            path.write_bytes(b'verified backup')
            pathlib.Path(str(path) + '.sha256').write_text(digest + '  ' + str(path))
            if timestamp is not None:
                pathlib.Path(str(path) + '.success.json').write_text(json.dumps({'status': 'success', 'completed_at': timestamp, 'backup': path.name, 'sha256': digest}))
            return path
        old = [backup(str(index), index) for index in range(12)]
        failed = backup('failed')
        recent = backup('recent', now - 86400)
        current = backup('current')
        unknown = self.root / 'unknown.dump'
        unknown.write_bytes(b'keep')
        linked = self.root / (sha + '-link.dump')
        linked.symlink_to(failed)
        pathlib.Path(str(linked) + '.sha256').write_text(digest + '  ' + str(linked))
        pathlib.Path(str(linked) + '.success.json').write_text(json.dumps({'status': 'success', 'completed_at': 0, 'backup': linked.name, 'sha256': digest}))
        environment = {**self.environment, 'SOTTO_BACKUP_DIR': str(self.root), 'SOTTO_RELEASE_SHA': sha, 'RETENTION_ATTEMPT_KEY': 'current'}
        retention.retain_backups(environment, now)
        self.assertFalse(any(path.exists() for path in old[:4]))
        self.assertTrue(all(path.exists() for path in old[4:] + [failed, recent, current, unknown, linked]))
        self.assertFalse(pathlib.Path(str(old[0]) + '.sha256').exists())
        self.assertFalse(pathlib.Path(str(old[0]) + '.success.json').exists())

    def test_missing_verified_backup_never_marks_a_deployment_successful(self):
        environment = {**self.environment, 'SOTTO_BACKUP_DIR': str(self.root), 'SOTTO_RELEASE_SHA': 'a' * 40}
        with self.assertRaises(ValueError):
            retention.update_record('backups-success', environment)
        self.assertEqual(list(self.root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
