# **App Name**: HireSense AI

## Core Features:

- Secure Authentication & Role Management: User registration and login via Firebase Email/Password, including a 'Forgot Password' feature with email validation and Firebase `sendPasswordResetEmail`. Supports Admin (manual creation) and Agency (Admin-created) roles, with roles stored in Firestore and determining access.
- Job Requisition Management (Admin): Admins can create, view, edit, and delete job requisitions. This includes uploading job descriptions (JD) which are converted to Base64 and stored directly in Firestore, respecting the 1MB file size limit. Edit functionality for JDs is restricted if candidate evaluation has started. The module provides real-time updates of projects in a table.
- AI-Powered JD Insights Tool: An AI tool that processes uploaded Job Descriptions (Base64 data from Firestore) to extract key requirements and potentially suggest relevant candidate criteria or initial screening questions, aiding recruiters in job posting setup and candidate matching.
- Candidate History & Access Control: Allows Admin users to view, search, and filter all candidate records (by Project, Agency) with full CRUD access. Agency users can only view their own agency's candidates, search, and filter by Project, with deletion functionality hidden. Implemented with Firestore Security Rules for backend validation.
- Admin Dashboard & Analytics: A system-wide dashboard for Admin users featuring dynamic filters (Project, Role, Agency, Status). Includes a Hiring Summary table (Total, Rejected, Accepted candidates) and a Chart.js-powered Pie Chart displaying candidate progress status (Round 1/2, HR, Offers Released) across all agencies and projects, updated in real-time.
- Agency Management & Unique ID Generation: Admin users can manage agencies, with new agencies automatically assigned a unique, non-editable Agency ID (e.g., AGY-0001). This module handles the creation and listing of agency details, which are then used across other modules for filtering and access control.
- Candidate Evaluation Workflow: Streamlined process for adding new candidate profiles, linking them to specific projects and agencies. Features an Agency ID dropdown, ensuring correct association. Stores project name, agency ID, agency name, candidate name, and evaluation status for each candidate record.

## Style Guidelines:

- Primary brand color: A calm and professional deep blue (#266DD8) to convey trust and reliability, suitable for a management system with a light color scheme.
- Background color: A subtle, light desaturated blue (#DDE7F6) that harmonizes with the primary color, providing a clean and approachable canvas for content.
- Accent color: A refreshing cyan (#40CAE4) that complements the primary blue, used sparingly for interactive elements, highlights, and status indicators to add visual interest and draw attention.
- Headline font: 'Space Grotesk' (sans-serif) for its modern, slightly tech-inspired aesthetic, suitable for clear, impactful headings in a recruitment and AI context.
- Body text font: 'Inter' (sans-serif) chosen for its legibility and neutrality, ensuring comfortable reading for the extensive data tables, forms, and descriptions typical of a management system.
- Consistent use of crisp, modern line-art or glyph icons for actions (e.g., eye, edit, delete, send, back) and informational elements to enhance user experience without clutter. Badges will clearly denote status like 'Open' (green) or 'Closed' (gray).
- A clean, structured, and responsive dashboard layout for both Admin and Agency users, utilizing card-based designs for summaries and tables for detailed listings. Modal dialogs (e.g., 'Forgot Password', 'Create Project') will be centrally aligned and consistent across the application for an intuitive user flow.
- Subtle, non-disruptive animations will be employed for state changes such as loading spinners, modal transitions, and dynamic updates of tables or charts, enhancing the perception of responsiveness and a polished user interface.