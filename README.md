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
