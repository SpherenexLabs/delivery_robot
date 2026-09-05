import { useEffect, useRef, useState } from 'react';
import { loadDeviceLocation } from '../services/firebaseDatabase';
import { isGoogleMapsConfigured, loadGoogleMaps } from '../services/googleMaps';

const STALE_AFTER_MS = 60000;
const trackerUrl = () => `${window.location.origin}${window.location.pathname}?panel=tracker`;

export default function LocationMap() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const watchIdRef = useRef(null);
  const deviceIntervalRef = useRef(null);
  const [source, setSource] = useState('device');
  const [position, setPosition] = useState(null);
  const [updatedAtMs, setUpdatedAtMs] = useState(null);
  const [nowMs, setNowMs] = useState(0);
  const [error, setError] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const applyPosition = (coords, sourceUpdatedAtMs = Date.now()) => {
    setPosition({
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
    });
    setUpdatedAtMs(sourceUpdatedAtMs);
    setError('');
  };

  const locateOnce = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setIsLocating(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      (result) => {
        applyPosition(result.coords);
        setIsLocating(false);
      },
      (geoError) => {
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission denied. Allow location access in the browser and try again.'
            : 'Could not determine your current location.',
        );
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const stopWatching = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsWatching(false);
  };

  const toggleWatch = () => {
    if (isWatching) {
      stopWatching();
      return;
    }

    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    setError('');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (result) => applyPosition(result.coords),
      (geoError) => {
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission denied. Allow location access in the browser and try again.'
            : 'Could not track your current location.',
        );
        stopWatching();
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    setIsWatching(true);
  };

  const fetchDeviceLocation = async () => {
    try {
      const data = await loadDeviceLocation();

      if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        applyPosition(data, data.updatedAtMs || Date.now());
      } else {
        setError('');
      }
    } catch (loadError) {
      setError(`Could not load the tracked device location: ${loadError.message}`);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      stopWatching();
      setPosition(null);
      setUpdatedAtMs(null);
      setError('');

      if (source === 'browser') {
        locateOnce();
        return;
      }

      fetchDeviceLocation();
      deviceIntervalRef.current = window.setInterval(fetchDeviceLocation, 4000);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      if (deviceIntervalRef.current) {
        window.clearInterval(deviceIntervalRef.current);
        deviceIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => () => stopWatching(), []);

  useEffect(() => {
    const updateNow = () => setNowMs(Date.now());
    const timer = window.setTimeout(updateNow, 0);
    const ticker = window.setInterval(updateNow, 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(ticker);
    };
  }, []);

  useEffect(() => {
    if (!position || !isGoogleMapsConfigured() || !mapRef.current) {
      return;
    }

    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) {
          return;
        }

        const center = { lat: position.latitude, lng: position.longitude };

        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new maps.Map(mapRef.current, {
            center,
            zoom: 16,
            streetViewControl: false,
            mapTypeControl: false,
          });
        } else {
          mapInstanceRef.current.setCenter(center);
        }

        if (!markerRef.current) {
          markerRef.current = new maps.Marker({
            position: center,
            map: mapInstanceRef.current,
            title: source === 'device' ? 'Tracked device' : 'Current location',
          });
        } else {
          markerRef.current.setPosition(center);
        }
      })
      .catch((mapError) => {
        if (!cancelled) {
          setError(mapError.message || 'Could not load Google Maps.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [position, source]);

  const copyTrackerLink = async () => {
    try {
      await navigator.clipboard.writeText(trackerUrl());
      setCopyStatus('Link copied');
    } catch {
      setCopyStatus('Could not copy. Copy it manually.');
    }
    window.setTimeout(() => setCopyStatus(''), 2500);
  };

  const isStale = source === 'device' && Boolean(updatedAtMs) && Boolean(nowMs) && nowMs - updatedAtMs > STALE_AFTER_MS;
  const secondsAgo = updatedAtMs && nowMs ? Math.max(0, Math.round((nowMs - updatedAtMs) / 1000)) : null;

  return (
    <section aria-label="Tracked location" className="location-panel">
      <div className="location-heading">
        <div>
          <span className="control-label">GPS</span>
          <strong>{source === 'device' ? 'Tracked Robot Location' : 'My Current Location'}</strong>
        </div>
        <div className="location-source-selector" role="group" aria-label="Location source">
          <button className={source === 'device' ? 'active' : ''} onClick={() => setSource('device')} type="button">
            Tracked Phone
          </button>
          <button className={source === 'browser' ? 'active' : ''} onClick={() => setSource('browser')} type="button">
            This Browser
          </button>
        </div>
      </div>

      {source === 'device' ? (
        <div className="location-tracker-link">
          <span>Open this link on the phone travelling with the robot to broadcast its GPS here:</span>
          <div>
            <code>{trackerUrl()}</code>
            <button className="secondary-btn" onClick={copyTrackerLink} type="button">
              {copyStatus || 'Copy Link'}
            </button>
          </div>
        </div>
      ) : (
        <div className="location-actions">
          <button className="secondary-btn" disabled={isLocating} onClick={locateOnce} type="button">
            {isLocating ? 'Locating...' : 'Refresh Location'}
          </button>
          <button className={`secondary-btn ${isWatching ? 'active' : ''}`} onClick={toggleWatch} type="button">
            {isWatching ? 'Stop Live Tracking' : 'Track Live'}
          </button>
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      {source === 'device' && !position && !error && (
        <p className="empty-state compact">No location received yet. Open the tracker link above on the phone and tap Start Broadcasting.</p>
      )}

      {position && (
        <div className="location-coords">
          <span>Lat {position.latitude.toFixed(6)}</span>
          <span>Lng {position.longitude.toFixed(6)}</span>
          {position.accuracy !== undefined && position.accuracy !== null && <span>±{Math.round(position.accuracy)} m accuracy</span>}
          {source === 'device' && secondsAgo !== null && (
            <span className={isStale ? 'stale' : ''}>{isStale ? 'Stale — ' : 'Updated '}{secondsAgo}s ago</span>
          )}
        </div>
      )}

      {isGoogleMapsConfigured() ? (
        <div className="location-map" ref={mapRef}></div>
      ) : (
        <p className="empty-state compact">
          Set VITE_GOOGLE_MAPS_API_KEY in .env to display the interactive map.
        </p>
      )}
    </section>
  );
}
