"""
Run once to rebuild the attachments table with the correct schema.
Usage (from the backend/ directory):
    python migrate_attachments.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "reports.db"

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

cur.execute("DROP TABLE IF EXISTS attachments")

cur.execute("""
CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT    NOT NULL,
    file_path   TEXT    NOT NULL,
    file_type   TEXT    NOT NULL DEFAULT '',
    folder_id   TEXT,
    template_id TEXT,
    report_id   INTEGER REFERENCES service_reports(id),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)
""")

cur.execute("CREATE INDEX ix_attachments_id        ON attachments (id)")
cur.execute("CREATE INDEX ix_attachments_folder_id  ON attachments (folder_id)")
cur.execute("CREATE INDEX ix_attachments_report_id  ON attachments (report_id)")

con.commit()
con.close()
print(f"Done — attachments table recreated at {DB_PATH}")
