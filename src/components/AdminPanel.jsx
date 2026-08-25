import { useEffect, useMemo, useRef, useState } from 'react';
import './AdminPanel.css';
import LiveMonitor from './LiveMonitor';
import ParcelForm from './ParcelForm';
import ParcelList from './ParcelList';
import ReceiverForm from './ReceiverForm';
import RobotControl from './RobotControl';
import TimerMapping from './TimerMapping';
import {
  activateBuzzAlert,
  deleteRecord,
  loadAdminData,
  loadRobotTelemetry,
  saveRecord,
  syncObstacleBuzzer,
  setObstacleSafety,
  updateRecord,
  writeDirection,
} from '../services/firebaseDatabase';

const makeId = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`;
const validTabs = new Set(['bookings', 'receivers', 'assignments', 'operations']);
const defaultRobotControl = {
  isRunning: false,
  mode: 'manual',
  command: 'stop',
  updatedAt: '',
  updatedAtMs: 0,
};
const emptyTelemetry = {
  battery: null,
  buzz: null,
  direction: 'S',
  obstacle: null,
  servo: null,
  voltage: null,
};
const hasFaceRegistration = (receiver) =>
  Boolean(receiver.faceDescriptors?.length || receiver.faceDescriptor?.length);

const getInitialTab = () => {
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  if (requestedTab === 'monitor' || requestedTab === 'mapping') {
    return 'operations';
  }
  return validTabs.has(requestedTab) ? requestedTab : 'bookings';
};

export default function AdminPanel() {
  const [parcels, setParcels] = useState([]);
  const [receivers, setReceivers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [bookingRoutes, setBookingRoutes] = useState({});
  const [faceReceiver, setFaceReceiver] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRobotSaving, setIsRobotSaving] = useState(false);
  const [isManualDirectionSaving, setIsManualDirectionSaving] = useState(false);
  const [manualDirection, setManualDirection] = useState('S');
  const [robotControl, setRobotControl] = useState(defaultRobotControl);
  const [robotTelemetry, setRobotTelemetry] = useState(emptyTelemetry);
  const [telemetryUpdatedAt, setTelemetryUpdatedAt] = useState('');
  const [isObstacleSafetyActive, setIsObstacleSafetyActive] = useState(false);
  const [isWaitingAtDestination, setIsWaitingAtDestination] = useState(false);
  const [timerMap, setTimerMap] = useState(null);
  const [timerMaps, setTimerMaps] = useState([]);
  const obstacleActiveRef = useRef(null);
  const safetyUpdatePendingRef = useRef(false);

  useEffect(() => {
    let shouldUpdate = true;

    const loadFirebaseData = async () => {
      try {
        const data = await loadAdminData();

        if (shouldUpdate) {
          setParcels(data.parcels);
          setReceivers(data.receivers);
          setAssignments(data.assignments);
          setBookings(data.bookings || []);
          setAlerts(data.alerts);
          setRobotControl({
            ...defaultRobotControl,
            ...data.robotControl,
          });
          setManualDirection(data.direction || 'S');
          setRobotTelemetry(data.telemetry);
          setTelemetryUpdatedAt(new Date().toLocaleTimeString());
          setTimerMap(data.timerMap);
          setTimerMaps(data.timerMaps);
        }
      } catch (error) {
        if (shouldUpdate) {
          setNotice(`Firebase load failed: ${error.message}`);
        }
      } finally {
        if (shouldUpdate) {
          setIsLoading(false);
        }
      }
    };

    loadFirebaseData();

    return () => {
      shouldUpdate = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const refreshAdminData = async () => {
      try {
        const data = await loadAdminData();
        setParcels(data.parcels);
        setReceivers(data.receivers);
        setAssignments(data.assignments);
        setAlerts(data.alerts);
        setBookings(data.bookings || []);
        setTimerMaps(data.timerMaps);
      } catch {
        // The main Firebase status already reports connection failures.
      }
    };

    const timer = window.setInterval(refreshAdminData, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let shouldUpdate = true;
    let refreshPending = false;

    const refreshTelemetry = async () => {
      if (refreshPending) {
        return;
      }

      refreshPending = true;
      try {
        const telemetry = await loadRobotTelemetry();

        if (shouldUpdate) {
          setRobotTelemetry(telemetry);
          setTelemetryUpdatedAt(new Date().toLocaleTimeString());
        }

        const obstacleDetected = Number(telemetry.obstacle) === 1;
        const directionNeedsSafetyStop = obstacleDetected && telemetry.direction !== 'S';
        const obstacleChanged = obstacleDetected !== obstacleActiveRef.current;

        if ((obstacleChanged || directionNeedsSafetyStop) && !safetyUpdatePendingRef.current) {
          safetyUpdatePendingRef.current = true;

          try {
            if (obstacleChanged) {
              await syncObstacleBuzzer(obstacleDetected);
            }
            const nextDirection = await setObstacleSafety(obstacleDetected, telemetry.direction);
            obstacleActiveRef.current = obstacleDetected;

            if (shouldUpdate) {
              setIsObstacleSafetyActive(obstacleDetected);
              setManualDirection(nextDirection);
              setRobotTelemetry((currentTelemetry) => ({
                ...currentTelemetry,
                direction: nextDirection,
              }));
              setNotice(
                obstacleDetected
                  ? 'Obstacle detected: robot stopped automatically'
                  : `Obstacle cleared: direction ${nextDirection} resumed`,
              );
            }
            if (obstacleDetected) {
              const createdAtMs = Date.now();
              await saveRecord('alerts', {
                  id: makeId('ALT'),
                  type: 'obstacle_detected',
                  message: 'Obstacle detected. The robot stopped and is waiting for the path to clear.',
                  resolved: false,
                  createdAt: new Date().toLocaleString(),
                  createdAtMs,
                });
            }
          } finally {
            safetyUpdatePendingRef.current = false;
          }
        }
      } catch {
        // Keep the latest hardware reading visible during a temporary connection failure.
      } finally {
        refreshPending = false;
      }
    };

    refreshTelemetry();
    const timer = window.setInterval(refreshTelemetry, 400);

    return () => {
      shouldUpdate = false;
      window.clearInterval(timer);
    };
  }, []);

  const assignedParcelIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.parcelId)),
    [assignments],
  );

  const runFirebaseAction = async (action, successMessage) => {
    setIsSaving(true);

    try {
      await action();
      setNotice(successMessage);
    } catch (error) {
      setNotice(`Firebase save failed: ${error.message}`);
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const saveRobotCommand = async (updates, successMessage, direction = null) => {
    const nextControl = {
      ...robotControl,
      ...updates,
      updatedAt: new Date().toLocaleString(),
      updatedAtMs: Date.now(),
    };

    setIsRobotSaving(true);

    try {
      await Promise.all([
        updateRecord('robotControl', 'current', nextControl),
        direction ? writeDirection(direction) : Promise.resolve(),
      ]);
      setRobotControl(nextControl);
      if (direction) {
        setManualDirection(direction);
      }
      setNotice(successMessage);
    } catch (error) {
      setNotice(`Robot command failed: ${error.message}`);
    } finally {
      setIsRobotSaving(false);
    }
  };

  const handleRobotPower = (isRunning) =>
    saveRobotCommand(
      {
        isRunning,
        command: isRunning ? 'start' : 'stop',
      },
      isRunning ? 'Start command sent: direction F' : 'Stop command sent: direction S',
      isRunning ? 'F' : 'S',
    );

  const handleRobotMode = (mode) => {
    if (mode === robotControl.mode) {
      return;
    }

    saveRobotCommand(
      {
        mode,
        command: mode === 'manual' ? 'set_manual_mode' : 'set_autonomous_mode',
      },
      `Robot mode changed to ${mode}`,
    );
  };

  const handleManualDirection = async (direction) => {
    setIsManualDirectionSaving(true);

    try {
      await writeDirection(direction);
      setManualDirection(direction);
      setNotice(`Manual direction ${direction} sent to Firebase`);
    } catch (error) {
      setNotice(`Manual direction failed: ${error.message}`);
    } finally {
      setIsManualDirectionSaving(false);
    }
  };

  const handleAddParcel = async (parcelData) => {
    const createdAtMs = Date.now();
    const newParcel = {
      id: makeId('PKG'),
      ...parcelData,
      status: 'ready',
      createdAt: new Date().toLocaleDateString(),
      createdAtMs,
    };

    await runFirebaseAction(async () => {
      await saveRecord('parcels', newParcel);
      setParcels((currentParcels) => [newParcel, ...currentParcels]);
    }, `Parcel ${newParcel.id} stored in Firebase`);
  };

  const handleSaveReceiverFace = async (receiverData) => {
    await runFirebaseAction(async () => {
      const faceUpdates = {
        faceImage: receiverData.faceImage,
        faceImageName: receiverData.faceImageName,
        faceDescriptor: receiverData.faceDescriptor,
        faceDescriptors: receiverData.faceDescriptors,
        faceRegisteredAt: receiverData.faceRegisteredAt,
        faceRegistrationStatus: 'complete',
      };
      await updateRecord('receivers', receiverData.id, faceUpdates);
      setReceivers((current) => current.map((receiver) => receiver.id === receiverData.id ? { ...receiver, ...faceUpdates } : receiver));
      setFaceReceiver(null);
    }, `Face registration completed for ${receiverData.name}`);
  };

  const handleDeleteParcel = async (parcelId) => {
    const assignmentIds = assignments
      .filter((assignment) => assignment.parcelId === parcelId)
      .map((assignment) => assignment.id);

    await runFirebaseAction(async () => {
      await Promise.all([
        deleteRecord('parcels', parcelId),
        ...assignmentIds.map((assignmentId) => deleteRecord('assignments', assignmentId)),
      ]);

      setParcels((currentParcels) => currentParcels.filter((parcel) => parcel.id !== parcelId));
      setAssignments((currentAssignments) =>
        currentAssignments.filter((assignment) => assignment.parcelId !== parcelId),
      );
    }, `Parcel ${parcelId} removed from Firebase`);
  };

  const handleDeleteReceiver = async (receiverId) => {
    const assignmentIds = assignments
      .filter((assignment) => assignment.receiverId === receiverId)
      .map((assignment) => assignment.id);
    const parcelIdsToReset = parcels
      .filter((parcel) => parcel.receiverId === receiverId)
      .map((parcel) => parcel.id);

    await runFirebaseAction(async () => {
      await Promise.all([
        deleteRecord('receivers', receiverId),
        ...assignmentIds.map((assignmentId) => deleteRecord('assignments', assignmentId)),
        ...parcelIdsToReset.map((parcelId) =>
          updateRecord('parcels', parcelId, { status: 'ready', receiverId: null }),
        ),
      ]);

      setReceivers((currentReceivers) =>
        currentReceivers.filter((receiver) => receiver.id !== receiverId),
      );
      setAssignments((currentAssignments) =>
        currentAssignments.filter((assignment) => assignment.receiverId !== receiverId),
      );
      setParcels((currentParcels) =>
        currentParcels.map((parcel) =>
          parcel.receiverId === receiverId
            ? { ...parcel, status: 'ready', receiverId: undefined }
            : parcel,
        ),
      );
    }, 'Receiver removed from Firebase');
  };

  const handleDeleteAssignment = async (assignmentId) => {
    const assignment = assignments.find((currentAssignment) => currentAssignment.id === assignmentId);

    await runFirebaseAction(async () => {
      await Promise.all([
        deleteRecord('assignments', assignmentId),
        assignment
          ? updateRecord('parcels', assignment.parcelId, { status: 'ready', receiverId: null })
          : Promise.resolve(),
      ]);

      setAssignments((currentAssignments) =>
        currentAssignments.filter((currentAssignment) => currentAssignment.id !== assignmentId),
      );

      if (assignment) {
        setParcels((currentParcels) =>
          currentParcels.map((parcel) =>
            parcel.id === assignment.parcelId
              ? { ...parcel, status: 'ready', receiverId: undefined }
              : parcel,
          ),
        );
      }
    }, 'Assignment removed from Firebase');
  };

  const handleAssignmentStatus = async (assignmentId, status) => {
    const statusUpdate = {
      status,
      statusUpdatedAt: new Date().toLocaleString(),
      statusUpdatedAtMs: Date.now(),
    };

    if (status === 'arrived') {
      statusUpdate.arrivedAt = statusUpdate.statusUpdatedAt;
    }

    await runFirebaseAction(async () => {
      await updateRecord('assignments', assignmentId, statusUpdate);
      setAssignments((currentAssignments) =>
        currentAssignments.map((assignment) =>
          assignment.id === assignmentId ? { ...assignment, ...statusUpdate } : assignment,
        ),
      );
      if (status === 'arrived') {
        await activateBuzzAlert();
      }
    }, `Delivery status changed to ${status.replaceAll('_', ' ')}`);

  };

  const handleBookingDecision = async (booking, approved) => {
    if (!approved) {
      await runFirebaseAction(async () => {
        await updateRecord('bookings', booking.id, { status: 'rejected', reviewedAt: new Date().toLocaleString() });
        setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: 'rejected' } : item));
      }, `Booking ${booking.id} rejected`);
      return;
    }

    const receiver = receivers.find((item) => item.id === booking.receiverId);
    const routeMapId = bookingRoutes[booking.id] || timerMaps[0]?.id || '';
    const route = timerMaps.find((item) => item.id === routeMapId);
    if (!receiver || !hasFaceRegistration(receiver)) {
      setNotice('Register this user’s face in Receivers before approving the booking.');
      return;
    }
    if (!route) {
      setNotice('Create and select a timer map before approving the booking.');
      return;
    }
    if (!route.returnSteps?.some((step) => Number(step.duration) > 0)) {
      setNotice('Record and save the return path for this location before approving the booking.');
      return;
    }

    // Generated only after the administrator clicks Approve.
    // eslint-disable-next-line react-hooks/purity
    const createdAtMs = Date.now();
    const parcel = {
      id: makeId('PKG'),
      description: booking.itemDetails,
      category: 'booked_item',
      weight: booking.weight || '',
      priority: 'normal',
      status: 'assigned',
      receiverId: receiver.id,
      bookingId: booking.id,
      createdAt: new Date().toLocaleDateString(),
      createdAtMs,
    };
    const assignment = {
      id: makeId('ASG'),
      parcelId: parcel.id,
      parcelDescription: parcel.description,
      parcelWeight: parcel.weight || 'Not specified',
      receiverId: receiver.id,
      receiverName: receiver.name,
      receiverPhone: receiver.phone,
      receiverAddress: booking.location || receiver.address,
      receiverFaceImage: receiver.faceImage,
      receiverFaceDescriptor: receiver.faceDescriptor,
      receiverFaceDescriptors: receiver.faceDescriptors,
      routeMapId: route.id,
      routeMapName: route.name,
      returnMode: 'reverse_outbound',
      returnDelaySeconds: Math.max(1, Number(route.returnDelaySeconds) || 30),
      deliverySlot: booking.slot,
      bookingId: booking.id,
      status: 'pending',
      createdAt: new Date().toLocaleDateString(),
      createdAtMs,
    };
    await runFirebaseAction(async () => {
      await Promise.all([
        saveRecord('parcels', parcel),
        saveRecord('assignments', assignment),
        updateRecord('bookings', booking.id, { status: 'approved', parcelId: parcel.id, assignmentId: assignment.id, routeMapId: route.id, reviewedAt: new Date().toLocaleString() }),
      ]);
      setParcels((current) => [parcel, ...current]);
      setAssignments((current) => [assignment, ...current]);
      setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status: 'approved', assignmentId: assignment.id } : item));
    }, `Booking ${booking.id} approved and assigned`);
  };

  const dismissAlert = async (alertId) => {
    await runFirebaseAction(async () => {
      await updateRecord('alerts', alertId, {
        resolved: true,
        resolvedAt: new Date().toLocaleString(),
      });
      setAlerts((currentAlerts) =>
        currentAlerts.map((alert) =>
          alert.id === alertId ? { ...alert, resolved: true } : alert,
        ),
      );
    }, 'Alert marked as resolved');
  };

  const tabs = [
    { id: 'bookings', label: 'Delivery Bookings', icon: 'box', count: bookings.filter((booking) => booking.status === 'new').length },
    { id: 'receivers', label: 'Registered Users', icon: 'person', count: receivers.length },
    { id: 'assignments', label: 'Delivery Queue', icon: 'route', count: assignments.length },
    { id: 'operations', label: 'Route & Live Monitor', icon: 'camera', count: timerMaps.length },
  ];

  return (
    <main className="admin-panel">
      <section className="admin-header">
        <div>
          <p className="eyebrow">Face detection-based autonomous delivery robot</p>
          <h1>Robot Admin Panel</h1>
          <p>Review bookings, register users, select mapped locations, and monitor secure deliveries.</p>
        </div>
        <div className="robot-status" aria-label="Robot status">
          <span className="status-dot"></span>
          {isLoading ? 'Loading Firebase' : 'Firebase connected'}
        </div>
      </section>

      <section className="admin-stats" aria-label="Admin overview">
        <div className="stat-box">
          <span className="stat-value">{bookings.filter((booking) => booking.status === 'new').length}</span>
          <span className="stat-label">New Bookings</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{receivers.length}</span>
          <span className="stat-label">Registered Users</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{assignments.length}</span>
          <span className="stat-label">Active Deliveries</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{assignments.filter((item) => item.status === 'returned').length}</span>
          <span className="stat-label">Returned to Base</span>
        </div>
      </section>

      <RobotTelemetry
        isObstacleSafetyActive={isObstacleSafetyActive}
        telemetry={robotTelemetry}
        updatedAt={telemetryUpdatedAt}
      />

      <RobotControl
        control={robotControl}
        disabled={isLoading || isRobotSaving || isObstacleSafetyActive}
        manualDirection={manualDirection}
        manualDirectionSaving={isManualDirectionSaving}
        onManualDirection={handleManualDirection}
        onModeChange={handleRobotMode}
        onPowerChange={handleRobotPower}
      />

      <nav className="admin-nav" aria-label="Admin sections">
        {tabs.map((tab) => (
          <button
            className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            <Icon name={tab.icon} />
            <span>{tab.label}</span>
            <strong>{tab.count}</strong>
          </button>
        ))}
      </nav>

      {notice && <div className="notice">{notice}</div>}
      {isSaving && <div className="notice saving">Saving to Firebase...</div>}
      {alerts.some((alert) => !alert.resolved) && (
        <section className="admin-alerts" aria-label="Authentication alerts">
          <div className="alerts-heading">
            <div>
              <strong>Authentication Alerts</strong>
              <span>{alerts.filter((alert) => !alert.resolved).length} require attention</span>
            </div>
          </div>
          {alerts
            .filter((alert) => !alert.resolved)
            .slice(0, 3)
            .map((alert) => (
              <div className="admin-alert-item" key={alert.id}>
                <div>
                  <strong>{alert.receiverName || 'Unknown receiver'}</strong>
                  <span>{alert.message}</span>
                  <small>{alert.createdAt}</small>
                </div>
                <button className="secondary-btn" onClick={() => dismissAlert(alert.id)} type="button">
                  Resolve
                </button>
              </div>
            ))}
        </section>
      )}

      <section className="admin-content">
        {isLoading && <p className="loading-state">Loading delivery robot data from Firebase.</p>}

        {activeTab === 'bookings' && (
          <section className="list-section">
            <h2>Delivery Requests</h2>
            <div className="assignments-grid">
              {bookings.length === 0 ? <p className="empty-state">No user bookings received yet.</p> : bookings.map((booking) => (
                <article className="assignment-card" key={booking.id}>
                  <div className="card-header"><div><span className="record-id">{booking.id}</span><h3>{booking.itemDetails}</h3></div><span className="status-badge">{booking.status}</span></div>
                  <div className="detail-list">
                    <div><dt>User</dt><dd>{booking.receiverName}</dd></div>
                    <div><dt>Slot</dt><dd>{booking.slot}</dd></div>
                    <div><dt>Location</dt><dd>{booking.location}</dd></div>
                  </div>
                  {booking.status === 'new' && (
                    <div className="booking-actions">
                      <select aria-label={`Route for ${booking.id}`} value={bookingRoutes[booking.id] || timerMaps[0]?.id || ''} onChange={(event) => setBookingRoutes((current) => ({ ...current, [booking.id]: event.target.value }))}>
                        <option value="">Select delivery route</option>
                        {timerMaps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
                      </select>
                      <button className="submit-btn" onClick={() => handleBookingDecision(booking, true)} type="button">Approve & Assign</button>
                      <button className="secondary-btn" onClick={() => handleBookingDecision(booking, false)} type="button">Reject</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'parcels' && (
          <div className="tab-content">
            <section className="form-section">
              <h2>Add Parcel Details</h2>
              <ParcelForm isSaving={isSaving || isLoading} onAddParcel={handleAddParcel} />
            </section>
            <section className="list-section">
              <h2>Parcel Queue</h2>
              <ParcelList parcels={parcels} assignedParcelIds={assignedParcelIds} onDelete={handleDeleteParcel} />
            </section>
          </div>
        )}

        {activeTab === 'receivers' && (
          <div className="tab-content">
            {faceReceiver && (
              <section className="form-section">
                <h2>Register Face for {faceReceiver.name}</h2>
                <p>The user details below came from the User Panel and cannot be changed here.</p>
                <ReceiverForm existingReceiver={faceReceiver} isSaving={isSaving || isLoading} key={faceReceiver.id} onCancel={() => setFaceReceiver(null)} onSaveReceiver={handleSaveReceiverFace} />
              </section>
            )}
            <section className="list-section">
              <h2>Receivers</h2>
              <div className="receivers-grid">
                {receivers.length === 0 ? (
                  <p className="empty-state">No receiver details added yet.</p>
                ) : (
                  receivers.map((receiver) => (
                    <article key={receiver.id} className="receiver-card">
                      <div className="card-header">
                        <div>
                          <span className="record-id">{receiver.id}</span>
                          <h3>{receiver.name}</h3>
                        </div>
                        <button
                          aria-label={`Delete receiver ${receiver.name}`}
                          className="icon-btn danger"
                          onClick={() => handleDeleteReceiver(receiver.id)}
                          title="Delete receiver"
                          type="button"
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                      <div className="face-card-row">
                        {receiver.faceImage ? (
                          <img
                            alt={`${receiver.name} face reference`}
                            className="face-thumb"
                            src={receiver.faceImage}
                          />
                        ) : (
                          <div className="face-placeholder">No face</div>
                        )}
                        <span className={`auth-badge ${hasFaceRegistration(receiver) ? 'registered' : 'missing'}`}>
                          {hasFaceRegistration(receiver) ? 'Recognition ready' : 'Face missing'}
                        </span>
                      </div>
                      <dl className="detail-list">
                        <div>
                          <dt>Phone</dt>
                          <dd>{receiver.phone}</dd>
                        </div>
                        <div>
                          <dt>Email</dt>
                          <dd>{receiver.email || 'Not added'}</dd>
                        </div>
                        <div>
                          <dt>Address</dt>
                          <dd>{receiver.address}</dd>
                        </div>
                        <div>
                          <dt>City</dt>
                          <dd>{receiver.city || 'Not added'}</dd>
                        </div>
                        <div>
                          <dt>Auth</dt>
                          <dd>{receiver.faceRegisteredAt || 'Not registered'}</dd>
                        </div>
                      </dl>
                      {receiver.notes && <p className="notes">{receiver.notes}</p>}
                      <p className="created-at">Added {receiver.createdAt}</p>
                      <button className="secondary-btn" onClick={() => setFaceReceiver(receiver)} type="button">
                        {hasFaceRegistration(receiver) ? 'Re-register Face' : 'Register Face'}
                      </button>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'assignments' && (
          <div className="tab-content">
            <section className="list-section">
              <h2>Robot Delivery Queue</h2>
              <div className="assignments-grid">
                {assignments.length === 0 ? (
                  <p className="empty-state">No approved deliveries are queued yet.</p>
                ) : (
                  assignments.map((assignment) => (
                    <article key={assignment.id} className="assignment-card">
                      <div className="card-header">
                        <div>
                          <span className="record-id">{assignment.id}</span>
                          <h3>{assignment.parcelDescription}</h3>
                        </div>
                        <button
                          aria-label={`Delete assignment ${assignment.id}`}
                          className="icon-btn danger"
                          onClick={() => handleDeleteAssignment(assignment.id)}
                          title="Delete assignment"
                          type="button"
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                      <div className="assignment-details">
                        <div className="detail-box">
                          <h4>Booked Item</h4>
                          <p>{assignment.parcelId}</p>
                          <p>{assignment.parcelWeight} kg</p>
                        </div>
                        <div className="detail-box">
                          <h4>Receiver</h4>
                          {assignment.receiverFaceImage && (
                            <img
                              alt={`${assignment.receiverName} face reference`}
                              className="face-thumb"
                              src={assignment.receiverFaceImage}
                            />
                          )}
                          <p>{assignment.receiverName}</p>
                          <p>{assignment.receiverPhone}</p>
                          <p>{assignment.receiverAddress}</p>
                          <p>{assignment.receiverFaceImage ? 'Face auth ready' : 'Face image missing'}</p>
                        </div>
                      </div>
                      {assignment.notes && <p className="notes">{assignment.notes}</p>}
                      <div className="assignment-status-row">
                        <span className="status-badge">{assignment.status}</span>
                        <select
                          aria-label={`Update delivery status for ${assignment.id}`}
                          disabled={isSaving}
                          onChange={(event) => handleAssignmentStatus(assignment.id, event.target.value)}
                          value={assignment.status}
                        >
                          <option value="pending">Pending</option>
                          <option value="in_transit">In transit</option>
                          <option value="arrived">Arrived</option>
                          <option value="authenticated">Authenticated</option>
                          <option value="delivered">Delivered</option>
                          <option value="auth_failed">Auth failed</option>
                          <option value="returning">Returning</option>
                          <option value="returned">Returned</option>
                        </select>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'operations' && (
          <div className="operations-workspace">
            <section className="list-section monitor-section operations-monitor">
              <div className="operations-section-heading">
                <div>
                  <span className="operations-kicker">Camera & authentication</span>
                  <h2>Live Delivery Monitor</h2>
                </div>
                <p>Start the camera before dispatch and keep it active until delivery authentication is complete.</p>
              </div>
              <LiveMonitor
                assignments={assignments}
                isWaitingAtDestination={isWaitingAtDestination}
                receivers={receivers}
              />
            </section>

            <section className="operations-route" aria-label="Delivery route timer mapping">
              {isLoading ? (
            <p className="loading-state">Loading timer map from Firebase.</p>
          ) : (
            <TimerMapping
              assignments={assignments}
              initialMap={timerMap}
              onDeliveryStatusChanged={(assignmentId, updates) =>
                setAssignments((current) =>
                  current.map((assignment) =>
                    assignment.id === assignmentId ? { ...assignment, ...updates } : assignment,
                  ),
                )
              }
              onDestinationWaitingChange={setIsWaitingAtDestination}
              onMapSaved={setTimerMap}
              onMapsChanged={setTimerMaps}
              onNotice={setNotice}
              savedMaps={timerMaps}
            />
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function RobotTelemetry({ isObstacleSafetyActive, telemetry, updatedAt }) {
  const metrics = [
    { id: 'battery', label: 'Battery', unit: '%' },
    { id: 'voltage', label: 'Voltage', unit: 'V' },
    { id: 'obstacle', label: 'Obstacle', unit: '' },
    { id: 'buzz', label: 'Buzz', unit: '' },
    { id: 'servo', label: 'Servo', unit: '' },
  ];

  return (
    <section
      className={`telemetry-panel ${isObstacleSafetyActive ? 'obstacle-active' : ''}`}
      aria-label="Live robot hardware telemetry"
    >
      <div className="telemetry-heading">
        <div>
          <span className="control-label">Hardware Robot</span>
          <strong>Live Telemetry</strong>
        </div>
        {isObstacleSafetyActive && (
          <span className="obstacle-warning">Obstacle detected - safety stop active</span>
        )}
        <span className="telemetry-refresh">
          <span className="telemetry-live-dot"></span>
          {updatedAt ? `Updated ${updatedAt}` : 'Waiting for Firebase'}
        </span>
      </div>
      <div className="telemetry-grid">
        {metrics.map((metric) => {
          const value = telemetry[metric.id];
          const hasValue = value !== null && value !== undefined && value !== '';

          return (
            <div className="telemetry-item" key={metric.id}>
              <span>{metric.label}</span>
              <strong>
                {hasValue ? value : '--'}
                {hasValue && metric.unit && <small>{metric.unit}</small>}
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Icon({ name }) {
  const icons = {
    box: (
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm3.1.1L12 10.5l5.9-2.9L12 4.7 6.1 7.6ZM5 9v7.2l6 3V12l-6-3Zm8 10.2 6-3V9l-6 3v7.2Z" />
    ),
    person: (
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0H4Z" />
    ),
    route: (
      <path d="M6 4a3 3 0 0 0-1 5.83V16a3 3 0 1 0 2 0V9.83A3 3 0 0 0 6 4Zm12 0a3 3 0 0 0-1 5.83V14a3 3 0 0 1-3 3h-2.17a3 3 0 1 0 0 2H14a5 5 0 0 0 5-5V9.83A3 3 0 0 0 18 4Z" />
    ),
    camera: (
      <path d="M9 4 7.5 6H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-2.5L15 4H9Zm3 13a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    ),
    timer: (
      <path d="M11 2h4v2h-4V2Zm1 12h2V8h-2v6Zm1 8a9 9 0 1 1 6.36-15.36l1.5-1.5 1.42 1.42-1.6 1.6A9 9 0 0 1 13 22Zm0-2a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
    ),
    trash: (
      <path d="M7 21a2 2 0 0 1-2-2V8h14v11a2 2 0 0 1-2 2H7ZM9 4h6l1 2h4v2H4V6h4l1-2Z" />
    ),
  };

  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
  );
}
