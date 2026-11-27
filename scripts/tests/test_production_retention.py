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

    def test_review_plan_preserves_two_exact_writers_outside_standard_projects(self):
        web_writer, worker_writer = "1" * 64, "2" * 64
        writer_images = {web_writer: "sha256:" + "e" * 64, worker_writer: "sha256:" + "f" * 64}
        environment = {**self.environment, "SOTTO_STACK": "sotto-review"}
        old = {"protected_images": sorted(writer_images.values())}
        stable = self.root / "sotto-review.json"
        stable.write_text(json.dumps(old))

        def docker(*args):
            if args[:2] == ("image", "inspect"):
                return self.images[args[-1]]
            if args[:2] == ("ps", "-aq"):
                return ""
            identity = args[-1]
            return f"{identity} {writer_images[identity]}"

        ids = (web_writer, worker_writer)
        with patch.object(retention, "docker", side_effect=docker):
            plan = retention.plan_begin(environment, review_writer_ids=ids)
            self.assertEqual(set(plan["successful_images"]),
                             {self.images["web"], self.images["workers"], *writer_images.values()})
            self.assertEqual(list(self.root.iterdir()), [stable])
            with self.assertRaisesRegex(ValueError, "discovery changed"):
                retention.update_record("begin", environment, expected_begin=plan)
            self.assertEqual(list(self.root.iterdir()), [stable])
            retention.update_record("begin", environment, review_writer_ids=ids,
                                    expected_begin=plan)
        attempt = self.root / "sotto-review-attempt-test.json"
        self.assertEqual(json.loads(attempt.read_text()), plan)
        self.assertEqual(json.loads(stable.read_text()), old)
        retention.update_record("success", environment)
        self.assertEqual(json.loads(stable.read_text()), {"protected_images": plan["successful_images"]})

    def test_review_plan_refuses_named_aliased_or_single_writer(self):
        review = {**self.environment, "SOTTO_STACK": "sotto-review"}
        for ids in (("review-old-web", "2" * 64), ("1" * 64, "1" * 64), ("1" * 64,)):
            with self.subTest(ids=ids), self.assertRaisesRegex(ValueError, "exact two"):
                retention.plan_begin(review, review_writer_ids=ids)
        with self.assertRaisesRegex(ValueError, "exact two"):
            retention.plan_begin(self.environment, review_writer_ids=("1" * 64, "2" * 64))
        self.assertEqual(list(self.root.iterdir()), [])

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

    def test_completed_backup_does_not_require_an_image_retention_directory(self):
        sha = 'a' * 40
        path = self.root / (sha + '-test.dump')
        path.write_bytes(b'verified backup')
        pathlib.Path(str(path) + '.sha256').write_text('b' * 64 + '  ' + path.name)
        environment = {**self.environment, 'SOTTO_BACKUP_DIR': str(self.root), 'SOTTO_RELEASE_SHA': sha}
        del environment['PRODUCTION_IMAGE_RETENTION_DIR']
        retention.update_record('backups-success', environment)
        proof = json.loads(pathlib.Path(str(path) + '.success.json').read_text())
        self.assertEqual(proof['backup'], path.name)


if __name__ == "__main__":
    unittest.main()
