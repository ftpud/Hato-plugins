-- Projects moved from SSH to Hato Cloud keep their original workspace id (project:<id>:root), so
-- agents, chats, workflows and views stored under it stay attached.
ALTER TABLE projects ADD COLUMN root_workspace INTEGER NOT NULL DEFAULT 0;
