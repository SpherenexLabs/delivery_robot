import * as faceapi from 'face-api.js';

const MODEL_PATH = '/models';
const MATCH_THRESHOLD = 0.5;
const DETECTOR_INPUT_SIZE = 320;

let modelPromise;

export const loadFaceModels = async () => {
  if (!modelPromise) {
    modelPromise = (async () => {
      if (faceapi.tf?.setBackend) {
        try {
          await faceapi.tf.setBackend('webgl');
          await faceapi.tf.ready();
        } catch {
          await faceapi.tf.setBackend('cpu');
          await faceapi.tf.ready();
        }
      }

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_PATH),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_PATH),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_PATH),
      ]);
    })();
  }

  return modelPromise;
};

const detectorOptions = () =>
  new faceapi.TinyFaceDetectorOptions({
    inputSize: DETECTOR_INPUT_SIZE,
    scoreThreshold: 0.55,
  });

const loadImage = (source) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not process the captured face image.'));
    image.src = source;
  });

export const createFaceDescriptor = async (imageSource) => {
  await loadFaceModels();
  const image = await loadImage(imageSource);
  const detections = await faceapi
    .detectAllFaces(image, detectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  if (detections.length === 0) {
    throw new Error('No face detected. Center the receiver face and capture again.');
  }

  if (detections.length > 1) {
    throw new Error('Multiple faces detected. Keep only the receiver in the camera view.');
  }

  const detection = detections[0];
  const imageArea = image.naturalWidth * image.naturalHeight;
  const faceArea = detection.detection.box.width * detection.detection.box.height;

  if (faceArea / imageArea < 0.08) {
    throw new Error('Face is too far from the camera. Move closer and capture again.');
  }

  if (detection.detection.score < 0.72) {
    throw new Error('Face image is unclear. Improve lighting and capture again.');
  }

  return Array.from(detection.descriptor);
};

const getReceiverDescriptors = (receiver) => {
  if (Array.isArray(receiver.faceDescriptors) && receiver.faceDescriptors.length > 0) {
    return receiver.faceDescriptors;
  }

  if (Array.isArray(receiver.faceDescriptor) && receiver.faceDescriptor.length > 0) {
    return [receiver.faceDescriptor];
  }

  return [];
};

export const detectAndMatchFaces = async (video, receivers) => {
  await loadFaceModels();

  const detections = await faceapi
    .detectAllFaces(video, detectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  const registeredReceivers = receivers
    .map((receiver) => ({
      receiver,
      descriptors: getReceiverDescriptors(receiver),
    }))
    .filter(({ descriptors }) => descriptors.length > 0);

  return detections.map((detection) => {
    let bestMatch = null;

    registeredReceivers.forEach(({ receiver, descriptors }) => {
      const distances = descriptors.map((descriptor) =>
        faceapi.euclideanDistance(detection.descriptor, new Float32Array(descriptor)),
      );
      const sortedDistances = distances.sort((first, second) => first - second);
      const comparisonCount = Math.min(2, sortedDistances.length);
      const distance =
        sortedDistances.slice(0, comparisonCount).reduce((sum, value) => sum + value, 0) /
        comparisonCount;

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { receiver, distance };
      }
    });

    const matched = Boolean(bestMatch && bestMatch.distance <= MATCH_THRESHOLD);

    return {
      box: detection.detection.box,
      distance: bestMatch?.distance ?? null,
      matched,
      receiver: matched ? bestMatch.receiver : null,
    };
  });
};
