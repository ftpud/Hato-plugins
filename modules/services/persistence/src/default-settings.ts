// Presentation defaults captured from the current setup. Existing saved values take precedence.
export const defaultSettings: Record<string, any> = {
  "ui-tables.v1": {
    "density": "comfortable",
    "stripes": true,
    "dividers": false
  },
  "layout.v1": {
    "v": 1,
    "settingsButton": true,
    "showPanelControls": true,
    "showPanelTitles": false,
    "showCollapsedTray": false,
    "showLeftSidebar": true,
    "showRightSidebar": true,
    "columns": [
      {
        "panels": [
          "projects",
          "ai"
        ],
        "sizes": [
          0.24940688908100128,
          0.7505931258201599
        ],
        "size": 0.2661226987838745
      },
      {
        "panels": [
          "git-changes"
        ],
        "sizes": [
          1
        ],
        "size": 0.2965085506439209
      },
      {
        "panels": [
          "files",
          "git"
        ],
        "sizes": [
          0.3997996658056925,
          0.6002003341943075
        ],
        "size": 0.1882619857788086
      },
      {
        "panels": [
          "mcps"
        ],
        "sizes": [
          1
        ],
        "size": 0.2491067945957184
      }
    ],
    "bottom": {
      "panels": [
        "terminal"
      ],
      "sizes": [
        1
      ],
      "collapsed": false
    },
    "mainSizes": [
      0.7367000579833984,
      0.26329997181892395
    ],
    "collapsed": {
      "ai": false,
      "files": false,
      "viewer": false,
      "workflows": true,
      "terminal": true,
      "agents": false,
      "projects": false,
      "git": false,
      "mcps": true,
      "git-changes": false,
      "remote": false,
      "git-history": false,
      "git-task-changes": false
    },
    "floating": {},
    "detached": {},
    "hidden": [
      "workflows",
      "viewer",
      "git-task-changes",
      "remote",
      "agents",
      "git-history"
    ],
    "bars": {
      "top": {
        "visible": true,
        "items": [
          "title",
          "workspace",
          "git-branch",
          "toolbarGap",
          "layoutMenu",
          "settings"
        ]
      },
      "bottom": {
        "visible": true,
        "items": [
          "machine",
          "toolbarSpace",
          "claude-usage",
          "codex-usage",
          "language-status",
          "approvals",
          "modules"
        ]
      }
    },
    "barItemsSeen": [
      "claude-usage",
      "git-branch",
      "codex-usage",
      "language-status"
    ]
  },
  "viewer.showMetadata": true,
  "viewer.renderMarkdown": false,
  "appearance.fontFamily": "JetBrains Mono",
  "appearance.fontSize": "14",
  "appearance.fontWeight": "400",
  "appearance.mode": "light",
  "viewer.diffMode": "split",
  "appearance.theme": "classic",
  "appearance.panelOpacity": "solid",
  "git-changes.diffMode": "unified",
  "git-changes.scope": "latest",
  "activity-sidebar.v1": {
    "projects": "left-top",
    "files": "right-top",
    "git": "right-top",
    "remote": "right-bottom",
    "viewer": "right-top",
    "git-changes": "right-top",
    "workflows": "left-bottom",
    "terminal": "left-bottom",
    "ai": "left-top",
    "agents": "right-bottom",
    "mcps": "right-bottom",
    "git-history": "left-bottom",
    "git-task-changes": "right-top"
  },
  "panel-sharing.v1": {
    "viewer": "space-1",
    "git-changes": "space-1",
    "workflows": "space-1",
    "files": "space-2",
    "remote": "space-11",
    "ai": "space-3",
    "mcps": "space-11",
    "agents": "space-11",
    "git": "space-9",
    "git-task-changes": "space-9",
    "terminal": "space-13",
    "git-history": "space-13"
  },
  "sidebar-order.v1": {
    "left-top": [
      "projects",
      "@spacer:e8409db7-385d-4f9d-8f94-82e2c14a9af3",
      "ai"
    ],
    "left-bottom": [
      "workflows",
      "git-history",
      "terminal"
    ],
    "right-top": [
      "files",
      "git",
      "git-task-changes",
      "viewer",
      "git-changes"
    ],
    "right-bottom": [
      "mcps",
      "agents",
      "remote"
    ]
  },
  "sidebar-grouping.v1": true,
  "appearance.projectsBackground": "subtle",
  "appearance.syntaxScheme": "weird"
};
