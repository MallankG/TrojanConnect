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

        self.assertEqual(store.load()["recognition"], {"checks": {}})

    def test_recognition_check_is_saved_and_survives_event_reset(self) -> None:
        result = pipeline_router.put_recognition_progress(
            pipeline_router.RecognitionProgressUpdate(check="eligibility", value=True)
        )

        self.assertTrue(result["recognition"]["checks"]["eligibility"])
        self.assertTrue(store.reset()["recognition"]["checks"]["eligibility"])

    def test_unknown_recognition_check_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as error:
            pipeline_router.put_recognition_progress(
                pipeline_router.RecognitionProgressUpdate(check="unknown", value=True)
            )

        self.assertEqual(error.exception.status_code, 400)
