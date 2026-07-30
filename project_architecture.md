# Project Architecture - ZAMAM System

This document maps the folder and file structure of the ZAMAM System, detailing the exact role of every file and folder in the workspace.

## Folder Directory Map

```
System/
├── .firebase/                  # Firebase CLI configuration cache
├── dist/                       # Production build output
├── public/                     # Static assets accessible directly
├── src/                        # Main source code directory
│   ├── assets/                 # Brand assets (logos, icons)
│   ├── components/             # Reusable modal and UI components
│   │   ├── TaskCreationModal.tsx
│   │   ├── UserCreationModal.tsx
│   │   └── UserEditModal.tsx
│   ├── lib/                    # SDK initializations & external services
│   │   ├── firebase.ts
│   │   └── googleDrive.ts
│   ├── pages/                  # Main page components representing routes
│   │   ├── AdminDashboard.tsx
│   │   ├── EmployeeWorkspace.tsx
│   │   └── Login.tsx
│   ├── App.css                 # Application-specific layout styling
│   ├── App.tsx                 # Root React component with routing rules
│   ├── index.css               # Global styling directives and Tailwind v4 config
│   ├── main.tsx                # React virtual DOM mounting entrypoint
│   └── types.ts                # Application data models and TypeScript definitions
├── .firebaserc                 # Firebase environment configuration
├── eslint.config.js            # Linter rules and exclusions
├── firebase.json               # Firebase hosting configurations
├── package.json                # Project dependencies and script runner configurations
├── postcss.config.js           # PostCSS Tailwind configurations
├── tsconfig.json               # Main TypeScript config referencing sub-configs
├── tsconfig.app.json           # Application TypeScript compiler settings
├── tsconfig.node.json          # Node scripts/Vite configuration compiler settings
└── vite.config.ts              # Vite configurations
```

---

## Component Roles & Descriptions

### 1. Routing & Core Setup
* **[main.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/main.tsx):** Renders the React 19 app into the HTML root element.
* **[App.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/App.tsx):** Configures react-router-dom paths:
  * `/` redirects to Login
  * `/admin` points to Admin Dashboard
  * `/workspace` points to Employee Workspace
* **[types.ts](file:///d:/downloads/استاذ صابر/مواقع/System/src/types.ts):** Holds structural types for `User`, `Task`, `PipelineStage`, `Role`, `Priority`, and `Status`.

### 2. Services & Integration Layer
* **[firebase.ts](file:///d:/downloads/استاذ صابر/مواقع/System/src/lib/firebase.ts):** Initializes standard Firebase client SDK tools (Authentication, Firestore Database, and Storage). Additionally initializes `SecondaryApp` to create accounts silently without logging out the administrator.
* **[googleDrive.ts](file:///d:/downloads/استاذ صابر/مواقع/System/src/lib/googleDrive.ts):** Encapsulates HTTP communications with the Google Apps Script Web App relay to handle automated folder creation and file integration in Google Drive.

### 3. Application Pages
* **[Login.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/pages/Login.tsx):** Validates credentials using Firebase Auth, cross-references credentials with the `users` Firestore collection to verify authorization, and enforces role-based routing (Admins to `/admin`, others to `/workspace`).
* **[AdminDashboard.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/pages/AdminDashboard.tsx):** Handles the main general management view, statistics KPIs, member settings, task overview, and configuration items.
* **[EmployeeWorkspace.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/pages/EmployeeWorkspace.tsx):** Displays a tailored page for employees to see their assigned pipeline tasks, upload work files, check references, and signal task completion.

### 4. Interactive Components
* **[TaskCreationModal.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/components/TaskCreationModal.tsx):** Manages dynamic stage pipelines (Creator -> Reviewer -> Uploader -> Manager -> DeputyManager) with optional file upload validation and admin checkpoints.
* **[UserCreationModal.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/components/UserCreationModal.tsx):** Admin form to spin up secondary Auth accounts and save user roles in Firestore.
* **[UserEditModal.tsx](file:///d:/downloads/استاذ صابر/مواقع/System/src/components/UserEditModal.tsx):** Admin utility to update roles and metadata for existing workspace employees.
