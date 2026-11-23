CREATE TABLE projects_v5 (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('local','ssh','cloud')),
  root_path TEXT NOT NULL, ssh_profile_id TEXT REFERENCES ssh_profiles(id),
  expanded INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  cloud_origin TEXT, cloud_host_id TEXT,
  CHECK((kind = 'cloud' AND cloud_origin IS NOT NULL AND cloud_host_id IS NOT NULL AND ssh_profile_id IS NULL)
     OR (kind <> 'cloud' AND cloud_origin IS NULL AND cloud_host_id IS NULL))
);
INSERT INTO projects_v5(id,name,kind,root_path,ssh_profile_id,expanded,created_at)
SELECT id,name,kind,root_path,ssh_profile_id,expanded,created_at FROM projects;

CREATE TABLE tasks_v5 (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects_v5(id),
  name TEXT NOT NULL, branch TEXT NOT NULL,
  worktree_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, branch)
);
INSERT INTO tasks_v5 SELECT * FROM tasks;
DROP TABLE tasks;
DROP TABLE projects;
ALTER TABLE projects_v5 RENAME TO projects;
ALTER TABLE tasks_v5 RENAME TO tasks;
CREATE INDEX idx_tasks_project ON tasks(project_id);
