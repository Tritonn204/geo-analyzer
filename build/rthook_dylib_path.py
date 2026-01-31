import os
import sys

if sys.platform == 'darwin':
    # Get the _internal directory where libraries are bundled
    if getattr(sys, 'frozen', False):
        bundle_dir = sys._MEIPASS
        # Prepend bundle dir to DYLD_LIBRARY_PATH so our SQLite is found first
        current_path = os.environ.get('DYLD_LIBRARY_PATH', '')
        os.environ['DYLD_LIBRARY_PATH'] = bundle_dir + ':' + current_path