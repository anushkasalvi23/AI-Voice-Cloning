import os
import tempfile

os.environ["VC_FAKE_ENGINE"] = "1"
os.environ["VC_DATA_DIR"] = tempfile.mkdtemp()
