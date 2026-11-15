import json
import tempfile
from importlib import import_module
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

from app.workflows.event_pipeline import store

pipeline_router = import_module("app.workflows.event_pipeline.router")


class RecognitionProgressTests(TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.state_path = self.data_dir / "event_pipeline.json"
        self.state_patches = (
            patch.object(store, "DATA_DIR", self.data_dir),
            patch.object(store, "STATE_PATH", self.state_path),
        )
        for state_patch in self.state_patches:
            state_patch.start()
            self.addCleanup(state_patch.stop)
        self.addCleanup(self.temp_dir.cleanup)

    def test_existing_state_gets_empty_recognition_progress(self) -> None:
        self.state_path.write_text(json.dumps({"profile": {}, "progress": {}, "log": []}))

        self.assertEqual(store.load()["recognition"], store.empty_recognition())

    def test_existing_recognition_checks_are_preserved_during_migration(self) -> None:
        self.state_path.write_text(json.dumps({
            "profile": {},
            "progress": {},
            "recognition": {"checks": {"constitution": True}},
            "log": [],
        }))

        recognition = store.load()["recognition"]

        self.assertTrue(recognition["checks"]["constitution"])
        self.assertEqual(recognition["pathway"], "undecided")
        self.assertFalse(recognition["officers"]["president"]["commitment"])

    def test_recognition_check_is_saved_and_survives_event_reset(self) -> None:
        result = pipeline_router.put_recognition_progress(
            pipeline_router.RecognitionProgressUpdate(check="constitution", value=True)
        )

        self.assertTrue(result["recognition"]["checks"]["constitution"])
        self.assertTrue(store.reset()["recognition"]["checks"]["constitution"])

    def test_unknown_recognition_check_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as error:
            pipeline_router.put_recognition_progress(
                pipeline_router.RecognitionProgressUpdate(check="unknown", value=True)
            )

        self.assertEqual(error.exception.status_code, 400)

    def test_officer_requirements_are_saved_per_role(self) -> None:
        result = pipeline_router.put_officer_progress(
            pipeline_router.OfficerProgressUpdate(
                role="president",
                requirement="commitment",
                value=True,
            )
        )

        self.assertTrue(result["recognition"]["officers"]["president"]["commitment"])
        self.assertFalse(result["recognition"]["officers"]["secretary"]["commitment"])

    def test_setup_accepts_only_engagesc_group_urls(self) -> None:
        setup = pipeline_router.RecognitionSetupUpdate(
            pathway="reestablishing",
            engageGroupUrl="https://engage.usc.edu/sample-rso/",
            additionalMemberCount=5,
        )

        result = pipeline_router.put_recognition_setup(setup)

        self.assertEqual(result["recognition"]["pathway"], "reestablishing")
        self.assertEqual(result["recognition"]["engageGroupUrl"], "https://engage.usc.edu/sample-rso/")
        self.assertEqual(result["recognition"]["additionalMemberCount"], 5)

        with self.assertRaises(ValueError):
            pipeline_router.RecognitionSetupUpdate(engageGroupUrl="https://attacker.example/")

    def test_application_status_is_saved(self) -> None:
        result = pipeline_router.put_recognition_status(
            pipeline_router.RecognitionStatusUpdate(status="requires_modifications")
        )

        self.assertEqual(result["recognition"]["applicationStatus"], "requires_modifications")

    def test_invalid_officer_role_and_status_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            pipeline_router.OfficerProgressUpdate(
                role="member",
                requirement="commitment",
                value=True,
            )
        with self.assertRaises(ValueError):
            pipeline_router.RecognitionStatusUpdate(status="submitted")
