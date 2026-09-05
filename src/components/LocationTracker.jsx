import { useEffect, useRef, useState } from 'react';
import { writeDeviceLocation } from '../services/firebaseDatabase';
import './LocationTracker.css';

export default function LocationTracker() {
  const [isTracking, setIsTracking] = useState(false);
  const [lastSentAt, setLastSentAt] = useState('');
  const [lastCoords, setLastCoords] = useState(null);
  const [error, setError] = useState('');
  const watchIdRef = useRef(null);

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setError('');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (result) => {
        const coords = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
          accuracy: result.coords.accuracy,
        };

        setLastCoords(coords);

        writeDeviceLocation(coords)
          .then(() => setLastSentAt(new Date().toLocaleTimeString()))
          .catch((sendError) => setError(`Could not send location: ${sendError.message}`));
      },
      (geoError) => {
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission denied. Allow location access for this page and try again.'
            : 'Could not read this device location.',
        );
        stopTracking();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setIsTracking(true);
  };

  useEffect(() => () => stopTracking(), []);

  return (
    <main className="tracker-page">
      <h1>Delivery Robot Location Tracker</h1>
      <p>Keep this page open on the phone travelling with the robot. It sends this device's GPS position to the Admin dashboard.</p>

      {error && <div className="notice error">{error}</div>}

      <button className="tracker-btn" onClick={isTracking ? stopTracking : startTracking} type="button">
        {isTracking ? 'Stop Broadcasting' : 'Start Broadcasting Location'}
      </button>

      {isTracking && (
        <div className="tracker-status">
          <span className="tracker-live-dot"></span>
          <div>
            <strong>Broadcasting live</strong>
            {lastCoords && (
              <p>
                Lat {lastCoords.latitude.toFixed(6)}, Lng {lastCoords.longitude.toFixed(6)}
                {lastCoords.accuracy !== undefined && ` (±${Math.round(lastCoords.accuracy)} m)`}
              </p>
            )}
            <p>{lastSentAt ? `Last sent to dashboard: ${lastSentAt}` : 'Waiting for the first GPS fix...'}</p>
          </div>
        </div>
      )}

      <p className="tracker-note">
        Do not close this tab or lock the screen while the delivery is in progress, or the dashboard will stop receiving updates.
      </p>
    </main>
  );
}
