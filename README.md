# Election Result Upload Portal — Action Alliance

Internal record-keeping tool for Action Alliance polling-unit agents and administrators.  
Designed for trustworthy, tamper-evident result capture and real-time constituency collation.

---

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Project Directory Structure](#project-directory-structure)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [1. Prerequisites & Environment](#1-prerequisites--environment)
  - [2. Database Setup](#2-database-setup)
  - [3. Running in Development](#3-running-in-development)
  - [4. Production Build](#4-production-build)
- [User Roles & Access Control](#user-roles--access-control)
- [Key Workflows & Features](#key-workflows--features)
  - [Agent Submission Flow](#agent-submission-flow)
  - [Administrator Dashboard & Collation](#administrator-dashboard--collation)
  - [Correction Review Workflow](#correction-review-workflow)
- [Specification Compliance](#specification-compliance)

---

## Architecture Overview

The system is delivered as a unified monorepo consisting of:
- **Backend API (`server/`)**: Node.js/Express + PostgreSQL with JWT authentication, role authorization, audit logging, file upload handling, and PDF/Excel export generators.
- **Frontend Single-Page App (`client/`)**: React 19 with Vite 5, Tailwind CSS 4, HeroUI, Poppins typography, and client-side offline queueing.
- **Root Runner (`dev.js`)**: Spawns both API and client concurrently on a single unified entry point (`http://localhost:4000`).

```
action-alliance-result-portal/
├── client/        # React 19 + Vite 5 + Tailwind CSS 4 + HeroUI
├── server/        # Node.js + Express + PostgreSQL
├── dev.js         # Concurrent development server orchestrator
└── README.md      # Project documentation
```

---

## Project Directory Structure

```
action-alliance-result-portal/
├── client/                                 # Frontend Web Application
│   ├── public/
│   │   └── aa-logo.png                     # Action Alliance emblem asset
│   ├── src/
│   │   ├── admin/                          # Administrator Portal
│   │   │   ├── components/
│   │   │   │   ├── Breadcrumbs.jsx         # Accessible breadcrumbs (Home + Back + HeroUI trail)
│   │   │   │   ├── ErrorBoundary.jsx       # Catch-all error boundary
│   │   │   │   ├── InviteCodesPanel.jsx    # Single PU agent invite code generator
│   │   │   │   ├── Layout.jsx              # Fixed static sidebar + scrollable admin layout
│   │   │   │   ├── MassInviteCodesButton.jsx # Bulk invite code generation (LGA/Ward scope)
│   │   │   │   └── PartyResultsPanel.jsx   # Leading party declaration & 21-party breakdown
│   │   │   └── pages/
│   │   │       ├── AdminsPage.jsx          # Admin account management & role assignment
│   │   │       ├── CorrectionsPage.jsx     # Multi-admin correction request review queue
│   │   │       ├── DashboardPage.jsx       # Constituency overview, search, stats, LGA list
│   │   │       ├── LgaPage.jsx             # LGA level drill-down and ward collation
│   │   │       ├── PollingUnitPage.jsx     # PU details, photo inspection, and PDF export
│   │   │       └── WardPage.jsx            # Ward level drill-down, PU table, PDF/XLSX export
│   │   ├── agent/                          # Polling Unit Agent Portal
│   │   │   ├── components/
│   │   │   │   ├── ActionBar.jsx           # Thumb-friendly bottom sticky action bar
│   │   │   │   ├── CameraCapture.jsx       # Live camera capture with GPS/timestamp overlay
│   │   │   │   ├── ProgressBar.jsx         # 5-step wizard progress indicator
│   │   │   │   └── steps/
│   │   │   │       ├── LocationStep.jsx    # Step 1: Assigned polling unit confirmation
│   │   │   │       ├── VoteCountsStep.jsx  # Step 2: Paper-ledger tally entry for 21 parties
│   │   │   │       ├── AgentDetailsStep.jsx# Step 3: Agent identity confirmation
│   │   │   │       ├── PhotoCaptureStep.jsx# Step 4: 3-photo camera capture (tag, sheet, agent)
│   │   │   │       └── PreviewStep.jsx     # Step 5: Final review before submission
│   │   │   ├── context/
│   │   │   │   └── SubmissionContext.jsx   # Multi-step state, autosave, offline submission
│   │   │   └── pages/
│   │   │       ├── ConfirmationPage.jsx    # Post-submission reference receipt
│   │   │       ├── RegisterPage.jsx        # Agent self-registration with invite code
│   │   │       └── WizardPage.jsx          # Submission wizard step container
│   │   ├── api/
│   │   │   ├── client.js                   # Authenticated API request client
│   │   │   └── offlineQueue.js             # IndexedDB queue & auto-sync on reconnect
│   │   ├── app/
│   │   │   └── router.jsx                  # React Router with role-based AuthGuard
│   │   ├── components/
│   │   │   ├── AaLogo.jsx                  # Scalable Action Alliance brand logo
│   │   │   └── SearchField.jsx             # Reusable HeroUI SearchField with action button
│   │   ├── context/
│   │   │   └── AuthContext.jsx             # Session, token persistence, 2FA OTP state
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx               # Email/phone + password authentication
│   │   │   └── OtpPage.jsx                 # 2FA 6-digit verification code screen
│   │   ├── styles/
│   │   │   ├── admin.css                   # Admin layout (fixed sidebar, sticky headers, tables)
│   │   │   ├── global.css                  # Mobile-first agent styles (ledger, action bar)
│   │   │   └── tokens.css                  # Color palette, Poppins typography, spacing tokens
│   │   ├── index.css                       # Tailwind CSS 4 theme + HeroUI + caret rules
│   │   └── main.jsx                        # React root entry point
│   ├── index.html                          # HTML template (Google Fonts Poppins & IBM Plex Mono)
│   ├── package.json
│   └── vite.config.js
├── server/                                 # Backend API Server
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js                       # PostgreSQL connection pool configuration
│   │   ├── db/
│   │   │   ├── data/
│   │   │   │   ├── ahiazu-constituency.json # Ahiazu Ezinihitte LGA/ward/PU hierarchy
│   │   │   │   └── political-parties.json  # 21 INEC-approved political parties list
│   │   │   ├── create-admin.js             # Chief Admin bootstrap script
│   │   │   ├── migrate.js                  # Idempotent database schema migration runner
│   │   │   ├── schema.sql                  # PostgreSQL schema, constraints, audit logs
│   │   │   └── seed.js                     # Idempotent seed script for constituency & parties
│   │   ├── middleware/
│   │   │   ├── audit.js                    # Admin action audit logger
│   │   │   ├── auth.js                     # JWT verification & role authorization middleware
│   │   │   ├── upload.js                   # Multer storage configuration for result photos
│   │   │   └── validateSubmission.js       # Zod validation schema for result submissions
│   │   ├── routes/
│   │   │   ├── admin.js                    # Admin routes (dashboard, hierarchy, exports, users)
│   │   │   ├── auth.js                     # Auth routes (login, 2FA verify, register)
│   │   │   ├── locations.js                # Constituency hierarchy lookup
│   │   │   └── submissions.js              # Agent result submission ingest & photo upload
│   │   ├── utils/
│   │   │   └── otp.js                      # 6-digit OTP generation and delivery helper
│   │   └── index.js                        # Express server entry point
│   ├── uploads/                            # Stored result photos directory
│   ├── package.json
│   └── .env.example
├── dev.js                                  # Local development runner
├── package.json                            # Root scripts
└── README.md                               # Project documentation
```

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | React 19, Vite 5, React Router 6 |
| **UI Components & Styles** | Tailwind CSS 4, HeroUI v3, Custom CSS Variables |
| **Typography** | Poppins (Full weight variations: 100–900 + italics), IBM Plex Mono |
| **Client Storage** | IndexedDB (Offline Submission Queue), `localStorage` (Drafts & Session) |
| **Backend Runtime** | Node.js (ES Modules), Express 4 |
| **Database** | PostgreSQL with `pg` connection pool |
| **Security & Auth** | JWT, bcrypt, 2FA OTP, Helmet, Express Rate Limit, Zod validation |
| **Document Generation**| PDFKit (PDF ward/PU reports), ExcelJS (XLSX export spreadsheets) |

---

## Getting Started

### 1. Prerequisites & Environment
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: v14.0 or higher

Create your environment configuration:
```bash
cd server
cp .env.example .env
```
Update `.env` with your PostgreSQL database credentials and JWT secret:
```ini
PORT=4000
DATABASE_URL=postgres://postgres:password@localhost:5432/election_portal
JWT_SECRET=your_secure_jwt_secret_key_here
```

### 2. Database Setup
Create the database, apply schema migrations, and seed initial constituency and political parties data:

```bash
# Create the PostgreSQL database
createdb election_portal

# From repository root (or inside server/):
npm run setup

# Bootstrap the initial Chief Admin account:
npm run create-admin -- "Chief Admin" admin@actionalliance.org StrongPassword123!
```

- **`npm run setup`**: Executes `migrate.js` (creates relational tables, indexes, constraints, and audit log triggers) followed by `seed.js` (loads the 2 LGAs, 24 Wards, and 265 Polling Units of Ahiazu Ezinihitte Federal Constituency, plus all 21 INEC-approved political parties). Both scripts are idempotent.

### 3. Running in Development
Start both the Express backend API and the Vite frontend simultaneously:

```bash
# At the repository root
npm run dev
```

Visit **`http://localhost:4000`** in your browser.
- Logging in as an **Admin** automatically routes to the **Admin Dashboard** (`/dashboard`).
- Logging in as a **Polling Unit Agent** automatically routes to the **Agent Submission Wizard** (`/submit`).

### 4. Production Build
To create an optimized production build:

```bash
# 1. Build frontend assets
cd client
npm run build

# 2. Start production server
cd ../server
NODE_ENV=production npm start
```

---

## User Roles & Access Control

| Role | Access Scope | Capabilities |
|---|---|---|
| **Agent (`agent`)** | Assigned Polling Unit | Complete 5-step result submission wizard, photo upload, local draft autosave, offline submission queue. |
| **Limited Admin (`limited_admin`)** | Constituency or Scoped LGA | View dashboard collation summaries, inspect polling unit details/photos, export PDF/Excel reports. |
| **Verifying Admin (`verifying_admin`)** | Constituency | All Limited Admin permissions + vote on and decide correction requests. |
| **Chief Admin (`chief_admin`)** | Full System | All Verifying Admin permissions + create/manage admin accounts and generate PU invite codes. |

### Agent Onboarding via Single-Use Invite Codes
Agents do not register openly or through manual database edits:
1. An admin opens a polling unit without an agent (`/polling-unit/:id`) and clicks **Generate Code** (or uses **Mass Invite Codes** at the LGA/Ward level).
2. The agent navigates to `/register`, enters the invite code, full name, phone/email, and password.
3. Upon registration, the invite code is consumed and the agent account is permanently locked to that specific polling unit.

---

## Key Workflows & Features

### Agent Submission Flow
1. **Location Confirmation**: Displays verified Polling Unit, Ward, and LGA assigned to the agent.
2. **Vote Counts Entry**: Paper-ledger-style tally sheet for all 21 INEC political parties. Action Alliance is pinned first. Total votes are automatically calculated and cross-verified.
3. **Agent Details**: Confirmation of agent identity and credentials.
4. **Photo Capture**: Live-camera-only capture (camera stream directly watermarked with timestamp + geolocation) for:
   - Agent Tag / Accreditation
   - Official Result Sheet (Form EC8A)
   - Agent Portrait / Passport
5. **Preview & Sign-Off**: Verification step before generating an immutable submission receipt and reference number.

### Offline Resilience
- If network connection drops in the field, submissions are queued securely in **IndexedDB** (`client/src/api/offlineQueue.js`) and automatically retried when connectivity is restored.

### Administrator Dashboard & Collation
- **Static Sidebar**: Pinned navigation layout with active indicators and user status always in view.
- **Sticky Breadcrumb & Heading Bar**: Pinned navigation header allowing one-click traversal (`Constituency → LGA → Ward → Polling Unit`).
- **Live Search**: Instant lookup for Local Governments, Wards, and Polling Units.
- **Real-Time Polling**: Auto-refreshes collation data every 15 seconds without manual page reloads.
- **Exports**: Instant generation of official PDF summaries and Excel (`.xlsx`) datasets.

---

## Specification Compliance

| Requirement | Description | Implementation Details |
|---|---|---|
| **FR-1: Authentication** | Password + 2FA OTP, rate limiting, session timeout | `server/src/routes/auth.js`, `client/src/context/AuthContext.jsx` |
| **FR-2: Result Submission** | 5-step wizard, live camera capture, watermarks | `client/src/agent/`, `server/src/routes/submissions.js` |
| **FR-3 & FR-4: Admin Collation** | Real-time totals, drill-down, search, PDF/Excel export | `client/src/admin/`, `server/src/routes/admin.js` |
| **SEC-1 & SEC-2: Input Integrity** | Strict schema validation, DB check constraints | Zod schemas in `validateSubmission.js`, PostgreSQL constraints |
| **SEC-3 & SEC-5: Immutability** | Append-only result submissions, duplicate protection | Unique constraint on `polling_unit_id`, multi-admin correction requests |
| **SEC-7: Geofencing** | Distance calculation against PU coordinates | Flags out-of-radius submissions with GPS badges in admin portal |
| **SEC-11: Audit Trail** | Comprehensive audit logging of admin actions | `server/src/middleware/audit.js` writing to `audit_logs` table |
| **UI Standards** | Poppins font family, caret suppression, mobile-first | `client/src/styles/`, `tokens.css`, `index.css` |
