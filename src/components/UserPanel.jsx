import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activateBuzzAlert,
  activateServoForDelivery,
  loadAdminData,
  saveRecord,
  updateRecord,
} from '../services/firebaseDatabase';
import { detectAndMatchFaces, loadFaceModels } from '../services/faceRecognition';
import './UserPanel.css';

const statusSteps = [
  { id: 'pending', label: 'Delivery accepted' },
  { id: 'in_transit', label: 'Robot in transit' },
  { id: 'arrived', label: 'Robot arrived' },
  { id: 'authenticated', label: 'Identity verified' },
  { id: 'delivered', label: 'Item collected' },
];

const statusOrder = {
  pending: 0,
  in_transit: 1,
  arrived: 2,
  auth_failed: 2,
  authenticated: 3,
  delivered: 4,
  returning: 5,
  returned: 6,
};

const normalizePhone = (value) => value.replace(/\D/g, '');
const makeId = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`;

export default function UserPanel() {
  const [lookup, setLookup] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [receiver, setReceiver] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [authResult, setAuthResult] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [booking, setBooking] = useState({ itemDetails: '', slot: '', location: '' });
  const [registration, setRegistration] = useState({ name: '', phone: '', email: '', address: '', accessCode: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported',
  );
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const lastStatusRef = useRef('');

  const selectedAssignment = useMemo(
    () =>
      assignments.find((assignment) => assignment.id === selectedAssignmentId) ||
      assignments[0] ||
      null,
    [assignments, selectedAssignmentId],
  );

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const findReceiverData = useCallback((data, searchValue) => {
    const normalizedSearch = normalizePhone(searchValue);
    const receiverMatch = data.receivers.find(
      (item) =>
        item.id.toLowerCase() === searchValue.trim().toLowerCase() ||
        (normalizedSearch && normalizePhone(item.phone) === normalizedSearch),
    );

    if (!receiverMatch) {
      return null;
    }

    const receiverAssignments = data.assignments
      .filter((assignment) => assignment.receiverId === receiverMatch.id)
      .sort((first, second) => {
        const deliveredDifference =
          Number(first.status === 'delivered') - Number(second.status === 'delivered');
        return deliveredDifference || (second.createdAtMs || 0) - (first.createdAtMs || 0);
      });

    return { receiver: receiverMatch, assignments: receiverAssignments };
  }, []);

  const refreshDelivery = useCallback(async (searchValue, showErrors = false) => {
    try {
      const data = await loadAdminData();
      const result = findReceiverData(data, searchValue);

      if (!result) {
        if (showErrors) {
          setMessage('No receiver was found for that phone number or receiver ID.');
        }
        return;
      }
      if (showErrors && result.receiver.accessCode && result.receiver.accessCode !== accessCode) {
        setMessage('Incorrect delivery access PIN.');
        return;
      }

      setReceiver(result.receiver);
      setAssignments(result.assignments);
      setSelectedAssignmentId((currentId) =>
        result.assignments.some((assignment) => assignment.id === currentId)
          ? currentId
          : result.assignments[0]?.id || '',
      );

      if (showErrors && result.assignments.length === 0) {
        setMessage('User found. No delivery has been approved yet.');
      } else {
        setMessage('');
      }
    } catch (error) {
      if (showErrors) {
        setMessage(`Could not load delivery: ${error.message}`);
      }
    }
  }, [accessCode, findReceiverData]);

  const handleLookup = async (event) => {
    event.preventDefault();

    if (!lookup.trim()) {
      setMessage('Enter your phone number or receiver ID.');
      return;
    }

    setIsLoading(true);
    await refreshDelivery(lookup, true);
    setIsLoading(false);
  };

  useEffect(() => {
    if (!receiver || !lookup) {
      return undefined;
    }

    const timer = window.setInterval(() => refreshDelivery(lookup), 3000);
    return () => window.clearInterval(timer);
  }, [lookup, receiver, refreshDelivery]);

  useEffect(() => {
    if (receiver?.address) {
      setBooking((current) => ({
        ...current,
        location: current.location || receiver.address,
      }));
    }
  }, [receiver]);

  useEffect(() => {
    const status = selectedAssignment?.status;
    if (!status) {
      return;
    }

    if (
      status === 'arrived' &&
      lastStatusRef.current !== 'arrived' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification('Delivery robot has arrived', {
        body: `Delivery ${selectedAssignment.id} is ready for facial authentication.`,
      });
    }

    if (
      status === 'delivered' &&
      lastStatusRef.current !== 'delivered' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification('Delivery completed successfully', {
        body: `Delivery ${selectedAssignment.id} has been collected and confirmed.`,
      });
    }

    lastStatusRef.current = status;
  }, [selectedAssignment]);

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      setMessage('Browser notifications are not supported on this device.');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setMessage(
      permission === 'granted'
        ? 'Arrival notifications enabled.'
        : 'Notification permission was not granted.',
    );
  };

  const handleRegistration = async (event) => {
    event.preventDefault();
    if (!registration.name.trim() || !registration.phone.trim() || !registration.address.trim() || !/^\d{4,8}$/.test(registration.accessCode)) {
      setMessage('Name, phone, address, and a 4–8 digit delivery access PIN are required.');
      return;
    }
    setIsSubmitting(true);
    const createdAtMs = Date.now();
    const newReceiver = {
      id: makeId('RCV'),
      ...registration,
      selfRegistered: true,
      faceRegistrationStatus: 'pending_admin_registration',
      createdAt: new Date().toLocaleDateString(),
      createdAtMs,
    };
    try {
      const existingData = await loadAdminData();
      const duplicate = existingData.receivers.some((item) => normalizePhone(item.phone) === normalizePhone(registration.phone));
      if (duplicate) {
        setMessage('This phone number is already registered. Use View Delivery instead.');
        return;
      }
      await saveRecord('receivers', newReceiver);
      setReceiver(newReceiver);
      setLookup(newReceiver.phone);
      setAssignments([]);
      setMessage('Registration saved. The admin must register your face before dispatch.');
    } catch (error) {
      setMessage(`Registration failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBooking = async (event) => {
    event.preventDefault();
    if (!receiver || !booking.itemDetails.trim() || !booking.slot || !booking.location.trim()) {
      setMessage('Enter item details, a delivery slot, and a delivery location.');
      return;
    }
    setIsSubmitting(true);
    const createdAtMs = Date.now();
    const request = {
      id: makeId('BKG'),
      receiverId: receiver.id,
      receiverName: receiver.name,
      receiverPhone: receiver.phone,
      receiverAddress: receiver.address,
      ...booking,
      status: 'new',
      createdAt: new Date().toLocaleString(),
      createdAtMs,
    };
    try {
      await Promise.all([
        saveRecord('bookings', request),
        saveRecord('alerts', {
          id: makeId('ALT'),
          type: 'new_booking',
          bookingId: request.id,
          receiverId: receiver.id,
          receiverName: receiver.name,
          message: `New delivery booking for ${request.itemDetails} at ${request.slot}.`,
          resolved: false,
          createdAt: request.createdAt,
          createdAtMs,
        }),
      ]);
      setBooking({ itemDetails: '', slot: '', location: '' });
      setMessage(`Booking ${request.id} sent to the administrator.`);
    } catch (error) {
      setMessage(`Booking failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera access is not supported in this browser.');
      return;
    }

    setIsCameraStarting(true);
    setAuthResult(null);

    try {
      await loadFaceModels();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setIsCameraActive(true);
    } catch {
      setMessage('Could not start the camera. Allow camera permission and try again.');
      stopCamera();
    } finally {
      setIsCameraStarting(false);
    }
  };

  const captureVerificationPhoto = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  };

  const writeAuthenticationFailure = async () => {
    const createdAtMs = Date.now();
    const verificationPhoto = captureVerificationPhoto();
    const alert = {
      id: makeId('ALT'),
      type: 'authentication_failed',
      assignmentId: selectedAssignment.id,
      parcelId: selectedAssignment.parcelId,
      receiverId: receiver.id,
      receiverName: receiver.name,
      message: `Face verification failed for delivery ${selectedAssignment.id}.`,
      resolved: false,
      createdAt: new Date().toLocaleString(),
      createdAtMs,
    };

    await Promise.all([
      updateRecord('assignments', selectedAssignment.id, {
        status: 'auth_failed',
        authenticationStatus: 'failed',
        authorizationStatus: 'pending',
        verificationPhoto,
        authenticationUpdatedAt: alert.createdAt,
      }),
      saveRecord('alerts', alert),
      activateBuzzAlert(),
      updateRecord('doorControl', 'current', {
        assignmentId: selectedAssignment.id,
        command: 'lock',
        isOpen: false,
        updatedAt: alert.createdAt,
        updatedAtMs: createdAtMs,
      }),
    ]);

    setAssignments((currentAssignments) =>
      currentAssignments.map((assignment) =>
        assignment.id === selectedAssignment.id
          ? { ...assignment, status: 'auth_failed', authenticationStatus: 'failed', authorizationStatus: 'pending', verificationPhoto }
          : assignment,
      ),
    );
  };

  const handleRemoteAuthorization = async (approved) => {
    const updatedAt = new Date().toLocaleString();
    const updates = {
      authorizationStatus: approved ? 'approved' : 'rejected',
      authorizationUpdatedAt: updatedAt,
      status: approved ? 'authenticated' : 'auth_failed',
    };
    setIsSubmitting(true);
    try {
      await Promise.all([
        updateRecord('assignments', selectedAssignment.id, updates),
        approved
          ? Promise.all([
              updateRecord('doorControl', 'current', {
                assignmentId: selectedAssignment.id,
                command: 'open_remote_authorization',
                isOpen: true,
                updatedAt,
                updatedAtMs: Date.now(),
              }),
              activateServoForDelivery(),
            ])
          : Promise.resolve(),
      ]);
      setAssignments((current) => current.map((item) => item.id === selectedAssignment.id ? { ...item, ...updates } : item));
      setAuthResult({ success: approved, message: approved ? 'Remote permission granted. Delivery box opened.' : 'Permission rejected. Delivery box remains locked.' });
    } catch (error) {
      setMessage(`Could not save permission: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyFace = async () => {
    if (!videoRef.current || !receiver || !selectedAssignment) {
      return;
    }

    setIsVerifying(true);

    try {
      const results = await detectAndMatchFaces(videoRef.current, [receiver]);
      const successfulMatch = results.length === 1 && results[0].matched;

      if (successfulMatch) {
        const updatedAt = new Date().toLocaleString();
        const updatedAtMs = Date.now();

        await Promise.all([
          updateRecord('assignments', selectedAssignment.id, {
            status: 'authenticated',
            authenticationStatus: 'successful',
            authenticatedAt: updatedAt,
          }),
          updateRecord('doorControl', 'current', {
            assignmentId: selectedAssignment.id,
            parcelId: selectedAssignment.parcelId,
            receiverId: receiver.id,
            command: 'open',
            isOpen: true,
            updatedAt,
            updatedAtMs,
          }),
          activateServoForDelivery(),
        ]);

        setAssignments((currentAssignments) =>
          currentAssignments.map((assignment) =>
            assignment.id === selectedAssignment.id
              ? { ...assignment, status: 'authenticated', authenticationStatus: 'successful' }
              : assignment,
          ),
        );
        setAuthResult({ success: true, message: 'Authentication successful. Delivery box opened.' });
        stopCamera();
      } else if (results.length === 0) {
        setAuthResult({ success: false, message: 'No face detected. Move closer and try again.' });
      } else {
        await writeAuthenticationFailure();
        setAuthResult({
          success: false,
          message: 'Verification failed. The box remains locked and the admin has been alerted.',
        });
      }
    } catch (error) {
      setAuthResult({ success: false, message: error.message });
    } finally {
      setIsVerifying(false);
    }
  };

  const confirmCollection = async () => {
    const updatedAt = new Date().toLocaleString();
    const updatedAtMs = Date.now();

    try {
      await Promise.all([
        updateRecord('assignments', selectedAssignment.id, {
          deliveredAt: updatedAt,
          deliveryConfirmation: 'collected',
        }),
        updateRecord('parcels', selectedAssignment.parcelId, {
          status: 'delivered',
          deliveredAt: updatedAt,
        }),
        updateRecord('doorControl', 'current', {
          assignmentId: selectedAssignment.id,
          command: 'close',
          isOpen: false,
          updatedAt,
          updatedAtMs,
        }),
      ]);

      setAssignments((currentAssignments) =>
        currentAssignments.map((assignment) =>
          assignment.id === selectedAssignment.id
            ? { ...assignment, deliveredAt: updatedAt, deliveryConfirmation: 'collected' }
            : assignment,
        ),
      );
      setAuthResult({ success: true, message: 'Item collection confirmed. Automatic return follows the saved route timer.' });
    } catch (error) {
      setMessage(`Could not confirm delivery: ${error.message}`);
    }
  };

  const currentStep = statusOrder[selectedAssignment?.status] ?? 0;
  const canAuthenticate = ['arrived', 'auth_failed'].includes(selectedAssignment?.status);

  return (
    <main className="user-panel">
      <header className="user-header">
        <div>
          <p className="user-eyebrow">Autonomous delivery robot user portal</p>
          <h1>My Delivery</h1>
          <p>Book an item delivery, track the robot, and verify your identity at secure handoff.</p>
        </div>
        <button className="user-secondary-btn" onClick={enableNotifications} type="button">
          {notificationPermission === 'granted' ? 'Notifications Enabled' : 'Enable Notifications'}
        </button>
      </header>

      <section className="user-feature-guide" aria-label="Delivery process">
        <div><span>1</span><strong>Register</strong><small>Create your profile and secure access PIN.</small></div>
        <div><span>2</span><strong>Book</strong><small>Choose a slot, item, and registered address.</small></div>
        <div><span>3</span><strong>Track</strong><small>Follow robot progress and receive arrival alerts.</small></div>
        <div><span>4</span><strong>Verify</strong><small>Authenticate or review a failed-verification photo.</small></div>
        <div><span>5</span><strong>Collect</strong><small>Open, collect, and confirm successful delivery.</small></div>
      </section>

      <section className="lookup-section">
        <form className="lookup-form" onSubmit={handleLookup}>
          <label htmlFor="receiverLookup">Phone Number or Receiver ID</label>
          <div>
            <input
              id="receiverLookup"
              onChange={(event) => setLookup(event.target.value)}
              placeholder="+91 98765 43210 or RCV-..."
              type="text"
              value={lookup}
            />
            <input
              aria-label="Delivery access PIN"
              inputMode="numeric"
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="Access PIN"
              type="password"
              value={accessCode}
            />
            <button disabled={isLoading} type="submit">
              {isLoading ? 'Checking...' : 'View Delivery'}
            </button>
          </div>
        </form>
        {message && <p className="user-message">{message}</p>}
      </section>

      {!receiver && (
        <section className="user-card user-action-card">
          <div className="user-card-heading"><div><span>New user</span><h2>Register</h2></div></div>
          <form className="user-action-form" onSubmit={handleRegistration}>
            <input aria-label="Full name" placeholder="Full name" value={registration.name} onChange={(event) => setRegistration({ ...registration, name: event.target.value })} />
            <input aria-label="Phone number" placeholder="Phone number" value={registration.phone} onChange={(event) => setRegistration({ ...registration, phone: event.target.value })} />
            <input aria-label="Email" placeholder="Email (optional)" type="email" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} />
            <input aria-label="Delivery address" placeholder="Delivery address" value={registration.address} onChange={(event) => setRegistration({ ...registration, address: event.target.value })} />
            <input aria-label="Delivery access PIN" inputMode="numeric" maxLength="8" placeholder="Create 4–8 digit access PIN" type="password" value={registration.accessCode} onChange={(event) => setRegistration({ ...registration, accessCode: event.target.value.replace(/\D/g, '') })} />
            <button className="user-primary-btn" disabled={isSubmitting} type="submit">Register User</button>
          </form>
        </section>
      )}

      {receiver && (
        <section className="user-card user-action-card">
          <div className="user-card-heading"><div><span>New request</span><h2>Book a Delivery Slot</h2><p>Enter your item and select the registered address where the robot should arrive.</p></div></div>
          <form className="user-action-form" onSubmit={handleBooking}>
            <input aria-label="Item details" placeholder="Item details" value={booking.itemDetails} onChange={(event) => setBooking({ ...booking, itemDetails: event.target.value })} />
            <input aria-label="Delivery slot" type="datetime-local" value={booking.slot} onChange={(event) => setBooking({ ...booking, slot: event.target.value })} />
            <select aria-label="Registered delivery location" value={booking.location} onChange={(event) => setBooking({ ...booking, location: event.target.value })}>
              <option value="">Select registered delivery address</option>
              <option value={receiver.address}>{receiver.address}</option>
            </select>
            <button className="user-primary-btn" disabled={isSubmitting} type="submit">Send Booking</button>
          </form>
          <p className="registered-location-note"><strong>Registered location:</strong> {receiver.address}</p>
        </section>
      )}

      {receiver && assignments.length > 0 && (
        <>
          <section className="user-summary">
            <div>
              <span>Receiver</span>
              <strong>{receiver.name}</strong>
            </div>
            <div>
              <span>Active Deliveries</span>
              <strong>{assignments.filter((assignment) => assignment.status !== 'delivered').length}</strong>
            </div>
            <div>
              <span>Delivery Address</span>
              <strong>{receiver.address}</strong>
            </div>
          </section>

          {assignments.length > 1 && (
            <label className="parcel-selector" htmlFor="userParcel">
              <span>Select Delivery</span>
              <select
                id="userParcel"
                onChange={(event) => {
                  setSelectedAssignmentId(event.target.value);
                  setAuthResult(null);
                  stopCamera();
                }}
                value={selectedAssignment?.id || ''}
              >
                {assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.id} - {assignment.parcelDescription} ({assignment.status})
                  </option>
                ))}
              </select>
            </label>
          )}

          {selectedAssignment && (
            <div className="user-delivery-grid">
              <section className="user-card delivery-card">
                <div className="user-card-heading">
                  <div>
                    <span>{selectedAssignment.id}</span>
                    <h2>{selectedAssignment.parcelDescription}</h2>
                  </div>
                  <span className={`user-status ${selectedAssignment.status}`}>
                    {selectedAssignment.status.replaceAll('_', ' ')}
                  </span>
                </div>

                <dl className="user-details">
                  <div>
                    <dt>Weight</dt>
                    <dd>{selectedAssignment.parcelWeight} kg</dd>
                  </div>
                  <div>
                    <dt>Assigned</dt>
                    <dd>{selectedAssignment.createdAt}</dd>
                  </div>
                  <div>
                    <dt>Delivery Address</dt>
                    <dd>{selectedAssignment.receiverAddress}</dd>
                  </div>
                </dl>

                <div className="delivery-timeline">
                  {statusSteps.map((step, index) => (
                    <div className={index <= currentStep ? 'complete' : ''} key={step.id}>
                      <span>{index < currentStep ? 'OK' : index + 1}</span>
                      <strong>{step.label}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="user-card auth-card">
                <div className="user-card-heading">
                  <div>
                    <span>Secure handoff</span>
                    <h2>Face Authentication</h2>
                  </div>
                </div>

                {selectedAssignment.status === 'arrived' && (
                  <div className="arrival-notice">
                    The robot has reached your delivery location. Stand in front of its camera.
                  </div>
                )}

                {!canAuthenticate && selectedAssignment.status === 'in_transit' && (
                  <p className="auth-instruction">Authentication becomes available when the robot arrives.</p>
                )}

                {!isCameraActive && canAuthenticate && (
                  <button
                    className="user-primary-btn"
                    disabled={isCameraStarting}
                    onClick={startCamera}
                    type="button"
                  >
                    {isCameraStarting ? 'Starting Camera...' : 'Start Face Verification'}
                  </button>
                )}

                <div className={`user-camera ${isCameraActive ? 'active' : ''}`}>
                  <video autoPlay muted playsInline ref={videoRef}></video>
                  {isCameraActive && <div className="user-face-guide"></div>}
                </div>

                {isCameraActive && (
                  <div className="user-camera-actions">
                    <button
                      className="user-primary-btn"
                      disabled={isVerifying}
                      onClick={verifyFace}
                      type="button"
                    >
                      {isVerifying ? 'Verifying...' : 'Verify My Face'}
                    </button>
                    <button className="user-secondary-btn" onClick={stopCamera} type="button">
                      Cancel
                    </button>
                  </div>
                )}

                {authResult && (
                  <div className={`auth-result ${authResult.success ? 'success' : 'failed'}`}>
                    <strong>{authResult.success ? 'Verification Successful' : 'Verification Failed'}</strong>
                    <span>{authResult.message}</span>
                  </div>
                )}

                {selectedAssignment.status === 'auth_failed' && selectedAssignment.verificationPhoto && (
                  <div className="remote-authorization">
                    <strong>Remote authorization requested</strong>
                    <span>Review the person photographed at the robot.</span>
                    <img alt="Person waiting at delivery robot" src={selectedAssignment.verificationPhoto} />
                    <div className="user-camera-actions">
                      <button className="user-primary-btn" disabled={isSubmitting} onClick={() => handleRemoteAuthorization(true)} type="button">Allow Opening</button>
                      <button className="user-secondary-btn" disabled={isSubmitting} onClick={() => handleRemoteAuthorization(false)} type="button">Reject</button>
                    </div>
                  </div>
                )}

                {selectedAssignment.status === 'authenticated' && selectedAssignment.deliveryConfirmation !== 'collected' && (
                  <div className="door-open-panel">
                    <strong>Delivery box is open</strong>
                    <span>Collect your booked item, close the compartment, then confirm collection.</span>
                    <button className="user-primary-btn" onClick={confirmCollection} type="button">
                      I Collected My Item
                    </button>
                  </div>
                )}

                {selectedAssignment.status === 'delivered' && (
                  <div className="delivery-confirmed">
                    <strong>Delivery Completed</strong>
                    <span>Item collected on {selectedAssignment.deliveredAt || 'today'}.</span>
                  </div>
                )}
                {['returning', 'returned'].includes(selectedAssignment.status) && (
                  <div className="delivery-confirmed">
                    <strong>{selectedAssignment.status === 'returning' ? 'Robot Returning' : 'Robot Returned to Base'}</strong>
                    <span>{selectedAssignment.status === 'returning' ? 'The return route is currently running.' : selectedAssignment.returnedAt}</span>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
