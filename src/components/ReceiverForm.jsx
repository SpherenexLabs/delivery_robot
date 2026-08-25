import { useEffect, useRef, useState } from 'react';
import { createFaceDescriptor, loadFaceModels } from '../services/faceRecognition';

const REQUIRED_FACE_SAMPLES = 3;

const initialFormData = {
  name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  zipCode: '',
  faceImage: '',
  faceImageName: '',
  faceDescriptor: [],
  faceDescriptors: [],
  faceRegisteredAt: '',
  notes: '',
};

export default function ReceiverForm({ existingReceiver, isSaving, onCancel, onSaveReceiver }) {
  const [formData, setFormData] = useState(() => ({
    ...initialFormData,
    ...existingReceiver,
    faceImage: '',
    faceImageName: '',
    faceDescriptor: [],
    faceDescriptors: [],
    faceRegisteredAt: '',
  }));
  const [cameraSource, setCameraSource] = useState('webcam');
  const [ipCameraUrl, setIpCameraUrl] = useState('');
  const [ipStreamUrl, setIpStreamUrl] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isProcessingFace, setIsProcessingFace] = useState(false);
  const videoRef = useRef(null);
  const ipImageRef = useRef(null);
  const streamRef = useRef(null);
  const faceSamples = Array.isArray(formData.faceDescriptors) ? formData.faceDescriptors : [];

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (ipImageRef.current) {
      ipImageRef.current.removeAttribute('src');
    }

    setIpStreamUrl('');
    setIsCameraActive(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  };

  const startWebcam = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      window.alert('Camera access is not supported in this browser.');
      return;
    }

    stopCamera();
    setIsStartingCamera(true);
    setCameraError('');

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

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsCameraActive(true);
    } catch {
      window.alert('Could not access the camera. Please allow camera permission and try again.');
    } finally {
      setIsStartingCamera(false);
    }
  };

  const connectIpCamera = async () => {
    const trimmedUrl = ipCameraUrl.trim();

    if (!trimmedUrl) {
      setCameraError('Enter the IP camera URL.');
      return;
    }

    stopCamera();
    setIsStartingCamera(true);
    setCameraError('');

    try {
      const cameraUrl = new URL(trimmedUrl);

      if (!['http:', 'https:', 'rtsp:'].includes(cameraUrl.protocol)) {
        throw new Error('Enter a complete RTSP, HTTP, or HTTPS camera URL.');
      }

      const isLegacyMaizicUrl =
        cameraUrl.protocol === 'http:' &&
        cameraUrl.port === '8080' &&
        cameraUrl.pathname.toLowerCase() === '/video';
      const streamUrl = isLegacyMaizicUrl
        ? `rtsp://${cameraUrl.username}:${cameraUrl.password}@${cameraUrl.hostname}:554/stream1`
        : trimmedUrl;
      const streamProtocol = new URL(streamUrl).protocol;

      await loadFaceModels();
      setIpStreamUrl(
        streamProtocol === 'rtsp:'
          ? `/api/ip-camera/stream?url=${encodeURIComponent(streamUrl)}`
          : streamUrl,
      );
    } catch (error) {
      setCameraError(error.message || 'Could not connect to the IP camera.');
      setIsStartingCamera(false);
    }
  };

  const startCamera = () => {
    if (cameraSource === 'ip') {
      connectIpCamera();
      return;
    }

    startWebcam();
  };

  const handleIpStreamLoaded = () => {
    setIsCameraActive(true);
    setIsStartingCamera(false);
    setCameraError('');
  };

  const handleIpStreamError = () => {
    setIsCameraActive(false);
    setIsStartingCamera(false);
    setIpStreamUrl('');
    setCameraError('Could not open the IP camera stream. Check the URL, login, network, and stream path.');
  };

  const changeCameraSource = (source) => {
    stopCamera();
    setCameraError('');
    setCameraSource(source);
  };

  const captureFace = async () => {
    const video = videoRef.current;
    const ipImage = ipImageRef.current;
    const source = cameraSource === 'ip' ? ipImage : video;
    const sourceWidth = cameraSource === 'ip' ? ipImage?.naturalWidth : video?.videoWidth;
    const sourceHeight = cameraSource === 'ip' ? ipImage?.naturalHeight : video?.videoHeight;
    const sourceReady =
      cameraSource === 'ip'
        ? Boolean(ipImage?.complete && sourceWidth)
        : Boolean(video && video.readyState >= 2);

    if (!source || !sourceReady) {
      window.alert('Camera is not ready yet. Please try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    const maxSize = 420;
    const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);

    const context = canvas.getContext('2d');
    if (cameraSource === 'webcam') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const faceImage = canvas.toDataURL('image/jpeg', 0.78);
    setIsProcessingFace(true);

    try {
      const faceDescriptor = await createFaceDescriptor(faceImage);
      const nextDescriptors = [...faceSamples, faceDescriptor];
      const registrationComplete = nextDescriptors.length >= REQUIRED_FACE_SAMPLES;

      setFormData((currentData) => ({
        ...currentData,
        faceImage: registrationComplete ? faceImage : currentData.faceImage,
        faceImageName: registrationComplete ? 'camera-capture.jpg' : currentData.faceImageName,
        faceDescriptor: registrationComplete ? nextDescriptors[0] : [],
        faceDescriptors: nextDescriptors,
        faceRegisteredAt: registrationComplete ? new Date().toLocaleString() : '',
      }));

      if (registrationComplete) {
        stopCamera();
      }
    } catch (error) {
      window.alert(error.message);
    } finally {
      setIsProcessingFace(false);
    }
  };

  const retakeFace = async () => {
    setFormData((currentData) => ({
      ...currentData,
      faceImage: '',
      faceImageName: '',
      faceDescriptor: [],
      faceDescriptors: [],
      faceRegisteredAt: '',
    }));
    await startCamera();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.name || !formData.phone || !formData.address) {
      window.alert('Please fill in receiver name, phone number, and delivery address.');
      return;
    }

    const phoneRegex = /^[0-9+\-\s()]{7,}$/;
    if (!phoneRegex.test(formData.phone)) {
      window.alert('Please enter a valid receiver phone number.');
      return;
    }

    if (
      !formData.faceImage ||
      faceSamples.length < REQUIRED_FACE_SAMPLES
    ) {
      window.alert(`Please capture all ${REQUIRED_FACE_SAMPLES} receiver face samples.`);
      return;
    }

    try {
      await onSaveReceiver(formData);
      stopCamera();
      setFormData(initialFormData);
    } catch {
      window.alert('Could not store this receiver in Firebase. Please check the database connection.');
    }
  };

  return (
    <form className="form receiver-form" onSubmit={handleSubmit}>
      <div className="form-row two-columns">
        <label className="form-group" htmlFor="name">
          <span>Receiver Name *</span>
          <input disabled id="name" name="name" onChange={handleChange} placeholder="Full name" type="text" value={formData.name} />
        </label>
        <label className="form-group" htmlFor="phone">
          <span>Phone Number *</span>
          <input disabled id="phone" name="phone" onChange={handleChange} placeholder="+91 98765 43210" type="tel" value={formData.phone} />
        </label>
      </div>

      <div className="form-row two-columns">
        <label className="form-group" htmlFor="email">
          <span>Email</span>
          <input disabled id="email" name="email" onChange={handleChange} placeholder="receiver@example.com" type="email" value={formData.email} />
        </label>
        <label className="form-group" htmlFor="zipCode">
          <span>Zip Code</span>
          <input disabled id="zipCode" name="zipCode" onChange={handleChange} placeholder="560001" type="text" value={formData.zipCode} />
        </label>
      </div>

      <div className="form-row two-columns">
        <label className="form-group" htmlFor="address">
          <span>Delivery Address *</span>
          <input
            disabled
            id="address"
            name="address"
            onChange={handleChange}
            placeholder="Building, room, street, or drop point"
            type="text"
            value={formData.address}
          />
        </label>
        <label className="form-group" htmlFor="city">
          <span>City</span>
          <input disabled id="city" name="city" onChange={handleChange} placeholder="City" type="text" value={formData.city} />
        </label>
      </div>

      <section className="camera-registration" aria-label="Receiver face registration">
        <div className="registration-camera-source">
          <div className="camera-source-selector" role="group" aria-label="Registration camera source">
            <button
              className={cameraSource === 'webcam' ? 'active' : ''}
              disabled={isStartingCamera || isProcessingFace}
              onClick={() => changeCameraSource('webcam')}
              type="button"
            >
              Webcam
            </button>
            <button
              className={cameraSource === 'ip' ? 'active' : ''}
              disabled={isStartingCamera || isProcessingFace}
              onClick={() => changeCameraSource('ip')}
              type="button"
            >
              IP Camera
            </button>
          </div>
          {cameraSource === 'ip' && (
            <label className="ip-camera-field" htmlFor="receiverIpCameraUrl">
              <span>IP Camera URL With Login</span>
              <input
                disabled={isCameraActive || isStartingCamera}
                id="receiverIpCameraUrl"
                onChange={(event) => setIpCameraUrl(event.target.value)}
                placeholder="rtsp://username:password@192.168.1.100:554/stream1"
                type="url"
                value={ipCameraUrl}
              />
            </label>
          )}
        </div>

        <div className="camera-heading">
          <div>
            <strong>Receiver Face Registration *</strong>
            <span>
              Capture {REQUIRED_FACE_SAMPLES} clear samples: front, slight left, and slight right.
            </span>
          </div>
          {!isCameraActive && !formData.faceImage && (
            <button className="secondary-btn" disabled={isStartingCamera} onClick={startCamera} type="button">
              {isStartingCamera
                ? cameraSource === 'ip'
                  ? 'Connecting...'
                  : 'Starting Camera...'
                : cameraSource === 'ip'
                  ? 'Connect IP Camera'
                  : 'Start Webcam'}
            </button>
          )}
        </div>

        {cameraError && <div className="notice error registration-camera-error">{cameraError}</div>}

        <div className={`camera-view ${isCameraActive ? 'active' : ''}`}>
          {cameraSource === 'webcam' ? (
            <video aria-label="Receiver camera preview" autoPlay muted playsInline ref={videoRef}></video>
          ) : (
            ipStreamUrl ? (
              <img
                alt="Receiver IP camera preview"
                crossOrigin="anonymous"
                onError={handleIpStreamError}
                onLoad={handleIpStreamLoaded}
                ref={ipImageRef}
                src={ipStreamUrl}
              />
            ) : null
          )}
          {isCameraActive && <div className="face-guide" aria-hidden="true"></div>}
        </div>

        {isCameraActive && (
          <div className="camera-actions">
            <button className="submit-btn" disabled={isProcessingFace} onClick={captureFace} type="button">
              {isProcessingFace
                ? 'Analyzing Face...'
                : `Capture Sample ${faceSamples.length + 1} of ${REQUIRED_FACE_SAMPLES}`}
            </button>
            <button className="secondary-btn" onClick={stopCamera} type="button">
              Cancel
            </button>
          </div>
        )}

        {isCameraActive && (
          <div className="sample-progress" aria-label="Face registration progress">
            {Array.from({ length: REQUIRED_FACE_SAMPLES }, (_, index) => (
              <span
                className={index < faceSamples.length ? 'complete' : ''}
                key={index}
              >
                {index + 1}
              </span>
            ))}
          </div>
        )}
      </section>

      {formData.faceImage && (
        <div className="face-preview">
          <img
            alt={`${formData.name || 'Receiver'} face reference`}
            className="face-thumb"
            src={formData.faceImage}
          />
          <div>
            <strong>Face registered</strong>
            <span>
              {faceSamples.length} recognition samples ready - {formData.faceRegisteredAt}
            </span>
          </div>
          <button className="secondary-btn" onClick={retakeFace} type="button">
            Retake
          </button>
        </div>
      )}

      <label className="form-group" htmlFor="notes">
        <span>Receiver Notes</span>
        <textarea
          id="notes"
          name="notes"
          onChange={handleChange}
          placeholder="Call before delivery, security desk handoff, access notes"
          rows="3"
          value={formData.notes}
        ></textarea>
      </label>

      <div className="form-actions">
        <button className="submit-btn" disabled={isSaving || isStartingCamera || isProcessingFace} type="submit">
          {isSaving ? 'Saving Face...' : 'Save Face Registration'}
        </button>
        <button className="secondary-btn" disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
      </div>
    </form>
  );
}
