# Smart Parcel Delivery Robot

A React-based control and delivery management system for a smart parcel delivery robot. The application provides separate Admin and Receiver panels, Firebase Realtime Database integration, timer-based autonomous mapping, manual robot control, live hardware telemetry, camera-based face registration, and receiver authentication.

## Project Overview

The system manages the complete parcel delivery workflow:

- Admin registers parcel and receiver details.
- Receiver delivery addresses are stored with receiver records.
- Admin registers three receiver face samples using a webcam or IP camera.
- Admin assigns parcels to registered receivers.
- Admin starts, stops, and controls the robot manually or autonomously.
- Manual movement writes `F`, `B`, `L`, `R`, or `S` to Firebase.
- Timer maps record movement directions and durations for autonomous delivery.
- Hardware telemetry displays battery, voltage, obstacle, buzzer, and servo values.
- Obstacle detection immediately overrides movement with `S`.
- The previous direction resumes after the obstacle clears.
- Live face recognition identifies registered receivers.
- Unknown faces generate an Admin alert and activate the buzzer for five seconds.
- Successful receiver authentication activates the delivery-box servo for ten seconds.
- Receivers can track parcels, receive arrival notifications, authenticate, and confirm collection.

## Architecture Diagram

```mermaid
flowchart LR
    A[Admin Dashboard] --> F[Firebase Realtime Database]
    U[Receiver Panel] --> F

    F <--> R[Delivery Robot Controller]
    R --> M[Motors]
    R --> S[Obstacle and Voltage Sensors]
    R --> B[Buzzer]
    R --> D[Delivery Box Servo]

    W[Webcam] --> C[Face Recognition]
    I[IP Camera RTSP] --> X[Local FFmpeg Bridge]
    X --> C
    C --> A
    C --> U
    C --> F

    F -->|direction F/B/L/R/S| R
    S -->|Battery, Voltage, Obstacle| F
    F -->|Buzz and Servo commands| R
```

### Camera Deployment Architecture

The local Vite server includes an FFmpeg bridge that converts an RTSP stream to browser-readable MJPEG:

```text
IP Camera -> RTSP -> Local Vite/FFmpeg Bridge -> Browser -> face-api.js
```

This bridge works only while the Vite development or preview server is running on a machine that can reach the camera.

For a public deployment:

```text
IP Camera -> RTSP -> Always-on local bridge/Raspberry Pi -> Public HTTPS stream -> Vercel UI
```

Vercel cannot directly access private camera addresses such as `10.x.x.x` or `192.168.x.x`, and the Vite `configureServer` bridge is not included in a static production deployment.

## Technology Stack

| Area | Technology |
| --- | --- |
| Frontend | React 19 |
| Build tool | Vite 8 |
| Styling | CSS |
| Database | Firebase Realtime Database REST API |
| Face detection | face-api.js |
| Face models | Tiny Face Detector, Face Landmark 68 Tiny, Face Recognition Net |
| IP camera conversion | FFmpeg |
| Camera protocols | Browser webcam API, RTSP, MJPEG |
| Code quality | ESLint |
| Hosting | Vercel for the frontend |

## Main Features

### Admin Panel

- Parcel registration and parcel queue
- Receiver registration and face training
- Webcam and authenticated IP camera support
- Parcel-to-receiver assignments
- Manual robot direction controls
- Robot start/stop and operating-mode controls
- Timer-based autonomous route creation
- Saved map selection and editing
- Live hardware telemetry
- Live receiver identification
- Authentication and unknown-person alerts

### Receiver Panel

- Receiver lookup using phone number or receiver ID
- Incoming parcel details
- Delivery status tracking
- Robot arrival notifications
- Face authentication
- Authentication result display
- Automatic delivery-box opening
- Final parcel collection confirmation

### Robot Safety and Hardware Actions

- `Obstacle = 1`: direction is immediately changed to `S`.
- `Obstacle = 0`: the most recent intended direction resumes.
- Unknown face: `Buzz = 1`, followed by `Buzz = 0` after five seconds.
- Registered receiver: `Servo = 1`, followed by `Servo = 0` after ten seconds.
- Start command: writes `F`.
- Stop command: writes `S`.

## How to Use the Dashboard (Step-by-Step)

The app opens with a top switcher, **Admin Panel** and **User Panel** (`App.jsx`). You can also jump straight to one with a URL:

```text
http://127.0.0.1:5173/?panel=admin
http://127.0.0.1:5173/?panel=user
```

### 1. User Panel — for the person receiving the parcel

Open **User Panel** (or `?panel=user`). The panel itself shows this 5-step guide at the top: **Register → Book → Track → Verify → Collect**.

1. **Register** (first-time users only)
   - Since there is no existing receiver record yet, a **Register** form is shown.
   - Fill in Full name, Phone number, Email (optional), Delivery address, and create a **4–8 digit delivery access PIN** — remember this PIN, it is needed for every future lookup.
   - Click **Register User**. This creates a receiver record in Firebase with `faceRegistrationStatus: pending_admin_registration`. At this point the receiver has no face on file yet, so an Admin must register their face before any delivery can be authenticated (see Admin Panel → Registered Users below).
   - If the phone number is already registered, you'll be told to use **View Delivery** instead.

2. **Look up your account** (returning users)
   - Under **Phone Number or Receiver ID**, enter your phone number or your `RCV-...` ID plus your access PIN, then click **View Delivery**.
   - This loads your receiver record and any delivery assignments tied to it.

3. **Book a delivery**
   - Once a receiver is loaded, a **Book a Delivery Slot** form appears.
   - Enter item details, pick a date/time slot, and select your registered delivery address (only your saved address is offered).
   - Click **Send Booking** — this creates a `bookings` entry with status `new` that appears in the Admin Panel's **Delivery Bookings** tab for approval.

4. **Track the delivery**
   - Once the admin approves your booking (see below), it becomes a delivery **assignment** and appears here with a live status timeline: `Delivery accepted → Robot in transit → Robot arrived → Identity verified → Item collected`.
   - If you have more than one active delivery, a dropdown lets you switch between them.
   - Click **Enable Notifications** to get a browser notification when the robot arrives and when delivery completes.

5. **Verify your identity** (once status is "Robot arrived")
   - A **Start Face Verification** button appears. Pick your webcam from the new **Webcam Selection** dropdown (Camera 0 / Camera 1) if you have more than one connected, then click it to open your camera.
   - Click **Verify My Face**. On a match, the delivery box unlocks automatically (servo command sent) and status becomes "Identity verified".
   - If verification fails, the admin is alerted with your snapshot and the box stays locked. If your delivery moves into `auth_failed`, this panel shows a **Remote authorization** card with the photo captured at the robot — you can **Allow Opening** or **Reject** it manually.

6. **Collect the item**
   - With the box open, take your item, close the compartment, then click **I Collected My Item**. This confirms delivery and the robot automatically follows its return route.

### 2. Admin Panel — for managing deliveries, robot, and cameras

Open **Admin Panel** (or `?panel=admin`, the default). Two controls are always visible at the top, above the tabs:

- **Robot Control** — Start/Stop power, switch **Manual**/**Autonomous** mode, and (in Manual mode) drive the robot with the Forward/Back/Left/Right/Stop pad. Every press writes a direction code straight to Firebase.
- **Live Telemetry** — read-only Battery, Voltage, Obstacle, Buzz, and Servo values reported by the robot, refreshed automatically. If an obstacle is detected the robot is force-stopped and this is flagged until it clears.

Right below Live Telemetry is a **GPS** panel with two sources:

- **Tracked Phone** (default): shows the location of whichever phone is broadcasting it. Open the copyable link shown in this panel (`?panel=tracker`) on the phone travelling with the robot/delivery, tap **Start Broadcasting Location**, and keep that tab open — it pushes GPS coordinates to Firebase every time the phone's position updates, and the dashboard polls and displays them every 4 seconds with a "how many seconds ago" freshness indicator (flagged **Stale** after 60s with no update).
- **This Browser**: falls back to the location of the computer/device the Admin Panel itself is open on, with **Refresh Location** and **Track Live** buttons.

The interactive map requires `VITE_GOOGLE_MAPS_API_KEY` to be set in `.env` (see `.env.example`); without it, only the raw coordinates are shown. Restrict that key in Google Cloud Console to your actual domain(s) since it ships inside the browser bundle.

Below that are five tabs:

1. **Delivery Bookings**
   - Shows every booking submitted from the User Panel with status `new`.
   - For each booking, pick a **delivery route** (created in Route & Live Monitor → Timer Mapping) from the dropdown, then click **Approve & Assign** to turn it into a parcel + delivery assignment, or **Reject** to decline it.
   - Approval is blocked if the receiver has no registered face yet, or if the chosen route has no saved return path — fix those first (see below).

2. **Registered Users**
   - Lists every receiver (both self-registered via User Panel and any added directly here).
   - Click **Register Face** (or **Re-register Face**) on a receiver card to capture their face: choose **Webcam** or **IP Camera**, pick **Camera 0 / Camera 1** if using a webcam, click **Start Webcam**, then capture 3 samples (front, slight left, slight right). This is required before any of that receiver's bookings can be approved.
   - Each card also shows phone, email, address, and a **Delete** button (icon-btn) to remove the receiver.

3. **Delivery Queue**
   - Shows every approved assignment: parcel details, receiver info, and face-auth readiness.
   - Click **Confirm Item Loaded** once you've physically placed the item in the robot's compartment.
   - Use the status dropdown to manually move a delivery through `pending → in_transit → arrived → authenticated → delivered` (or `auth_failed`, `returning`, `returned`) if you need to override automatic updates.

4. **Route & Live Monitor**
   - **Live Delivery Monitor** (left): start the robot's camera (Webcam with Camera 0/1 selection, or an authenticated IP/RTSP camera) to watch live face recognition. Detected faces are boxed and labeled; an unknown face raises an alert and buzzes the robot, a recognized/arrived receiver triggers the delivery servo.
   - **Timer Mapping** (right): build a named **route** as a sequence of movement steps (direction + duration in seconds) for autonomous delivery — record an **outbound** path to the destination and a **return** path back to base, then set a return delay. Save the route; it then becomes selectable when approving bookings in the Delivery Bookings tab.

5. **Alerts & Snapshots**
   - History of unknown-person detections captured by Live Monitor, each with a snapshot photo, timestamp, and camera source.
   - Click **Mark as resolved** once you've reviewed one.

### 3. End-to-end delivery walkthrough

1. User registers in the User Panel and sets a PIN.
2. Admin opens **Registered Users**, finds the new receiver, and registers their face (3 samples).
3. Admin (or someone) creates at least one route with a return path in **Route & Live Monitor → Timer Mapping**.
4. User logs back in (phone + PIN) and submits a booking.
5. Admin reviews it in **Delivery Bookings**, picks the route, and clicks **Approve & Assign**.
6. Admin loads the item and clicks **Confirm Item Loaded** in **Delivery Queue**.
7. Admin starts the robot (Robot Control → Start, Autonomous mode) and/or runs the Timer Mapping route.
8. When the robot arrives, its status becomes `arrived`; the User Panel and Admin's Live Monitor can both authenticate the receiver's face.
9. On a successful match the delivery box unlocks; the user collects the item and confirms collection.
10. The robot then follows its saved return path back to base.

## Firebase Structure

All project data is stored under:

```text
smartDeliveryRobotAdmin
```

Important paths:

```text
smartDeliveryRobotAdmin/
  parcels/
  receivers/
  assignments/
  alerts/
  direction
  Battery
  Voltage
  Obstacle
  Buzz
  Servo
  robotControl/current
  doorControl/current
  timerMap/current
  timerMaps/
```

Direction codes:

| Direction | Firebase value |
| --- | --- |
| Forward | `F` |
| Backward | `B` |
| Left | `L` |
| Right | `R` |
| Stop | `S` |

## Prerequisites

Install the following before running the project:

- Node.js 20 or newer
- npm
- FFmpeg available in the system `PATH` for RTSP camera support
- A modern browser with camera permission
- Access to the configured Firebase Realtime Database

Verify FFmpeg:

```bash
ffmpeg -version
```

## Installation

1. Clone or download the project.

2. Open the project directory:

```bash
cd Smart_delivery_robot
```

3. Install dependencies:

```bash
npm install
```

4. Confirm that the face-recognition model files are available in:

```text
public/models/
```

5. Review the Firebase configuration in:

```text
src/services/firebaseDatabase.js
```

## Execute the Project

Start the development server:

```bash
npm run dev
```

Open the URL printed by Vite, usually:

```text
http://127.0.0.1:5173/
```

Useful direct URLs:

```text
http://127.0.0.1:5173/?panel=admin
http://127.0.0.1:5173/?panel=user
http://127.0.0.1:5173/?tab=monitor
http://127.0.0.1:5173/?tab=mapping
```

If the default port is occupied, Vite selects another port automatically.

## IP Camera Setup

Select **IP Camera** in Live Monitor or Receiver Face Registration and enter one authenticated URL:

```text
rtsp://username:password@camera-ip:554/stream1
```

The application also converts the legacy Maizic format:

```text
http://username:password@camera-ip:8080/video
```

to:

```text
rtsp://username:password@camera-ip:554/stream1
```

The computer running Vite and FFmpeg must be on a network that can reach the camera.

## Build and Validation

Run lint:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Vercel Deployment Limitation

The React frontend can be deployed to Vercel, but the local RTSP bridge cannot run as part of the static Vite build. Private IP cameras are also not reachable from Vercel infrastructure.

To use an IP camera after deployment, run an always-on bridge on a Raspberry Pi, robot computer, or local server that:

1. Connects to the camera through RTSP.
2. Converts the video to MJPEG, HLS, or WebRTC.
3. Publishes the stream through an authenticated HTTPS endpoint.
4. Allows the deployed frontend to access that endpoint.

Do not expose camera usernames and passwords in a public frontend or repository.

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build the production frontend |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |

## Security Notes

- Configure Firebase security rules before production use.
- Move Firebase configuration to environment variables for production.
- Keep camera credentials out of source control and public browser URLs.
- Protect public camera bridges with authentication and HTTPS.
- Restrict hardware write permissions to trusted Admin clients or a backend service.
