import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class DesktopPathsTest(unittest.TestCase):
    def test_desktop_library_is_outside_application_and_used_by_all_stores(self):
        with tempfile.TemporaryDirectory() as directory:
            library = Path(directory) / "Library"
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import json,generation_store as s,voice_store as v; s.init_db(); print(json.dumps([str(s.DB_PATH),str(s.GENERATIONS_DIR),str(v.ROOT)]))",
                ],
                cwd=Path(__file__).parent.parent,
                env={**os.environ, "VIBEPOD_DATA_DIR": str(library)},
                capture_output=True,
                text=True,
                check=True,
            )
            locations = [Path(value) for value in json.loads(result.stdout)]
            self.assertTrue(all(location.is_relative_to(library) for location in locations))
            self.assertTrue((library / "db" / "vibepod.db").exists())
