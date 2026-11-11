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
          0.27761676080176945,
          0.7223832391982306
        ],
        "size": 0.3348941206932068
      },
      {
        "panels": [
          "viewer"
        ],
        "sizes": [
          1
        ],
        "size": 0.24116086959838867
      },
      {
        "panels": [
          "files",
          "git"
        ],
        "sizes": [
          0.5704587697982788,
          0.4295412302017212
        ],
        "size": 0.17483821511268616
      },
      {
        "panels": [
          "agents"
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
      0.7827808027630805,
      0.2172191972369195
    ],
    "collapsed": {
      "ai": false,
      "files": false,
      "viewer": false,
      "workflows": false,
      "terminal": true,
      "agents": false,
      "projects": false,
      "git": false,
      "mcps": true,
      "git-changes": false,
      "remote": false
    },
    "floating": {},
    "detached": {},
    "hidden": [
      "workflows",
      "remote",
      "git-changes",
      "mcps"
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
    "git-changes": "right-bottom",
    "workflows": "left-bottom",
    "terminal": "left-bottom",
    "ai": "left-top",
    "agents": "right-bottom",
    "mcps": "right-bottom"
  },
  "panel-sharing.v1": {
    "viewer": "space-1",
    "git-changes": "space-1",
    "workflows": "space-1",
    "files": "space-2",
    "remote": "space-11",
    "ai": "space-3",
    "mcps": "space-11",
    "agents": "space-11"
  },
  "sidebar-order.v1": {
    "left-top": [
      "projects",
      "@spacer:e8409db7-385d-4f9d-8f94-82e2c14a9af3",
      "ai"
    ],
    "left-bottom": [
      "workflows",
      "terminal"
    ],
    "right-top": [
      "files",
      "git",
      "viewer"
    ],
    "right-bottom": [
      "git-changes",
      "mcps",
      "agents",
      "remote"
    ]
  },
  "sidebar-grouping.v1": true,
  "appearance.projectsBackground": "subtle",
  "appearance.syntaxScheme": "weird"
};
