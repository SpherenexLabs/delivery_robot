import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteRecord, saveRecord, updateRecord, writeDirection } from '../services/firebaseDatabase';

const directionOptions = [
  { label: 'Forward', value: 'forward', code: 'F' },
  { label: 'Backward', value: 'backward', code: 'B' },
  { label: 'Left', value: 'left', code: 'L' },
  { label: 'Right', value: 'right', code: 'R' },
  { label: 'Stop', value: 'stop', code: 'S' },
];

const oppositeDirection = {
  forward: 'backward',
  backward: 'forward',
  left: 'right',
  right: 'left',
  stop: 'stop',
};

const createStep = () => ({
  id: `STEP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  direction: '',
  duration: 0,
});

const createMapId = () => `MAP-${Date.now().toString(36).toUpperCase()}`;
const getDirection = (value) =>
  directionOptions.find((direction) => direction.value === value) || null;
const getRunnableStep = (step, originalIndex = 0) => ({
  ...step,
  originalIndex,
  duration: Number(step.duration),
  code: getDirection(step.direction)?.code || '',
});
const getValidRunnableSteps = (mapSteps) =>
  mapSteps
    .map(getRunnableStep)
    .filter((step) => step.code && step.duration > 0);
const getTotalDuration = (mapSteps) =>
  getValidRunnableSteps(mapSteps).reduce((sum, step) => sum + step.duration, 0);

const buildInitialEditor = (savedMaps, initialMap) => {
  const map = savedMaps.find((item) => item.id === initialMap?.id) || initialMap || savedMaps[0];
  return {
    selectedMapId: map?.id || '',
    mapName: map?.name || '',
    steps: map?.steps || [],
    returnSteps: map?.returnSteps || [],
    returnDelaySeconds: Number(map?.returnDelaySeconds) || 30,
  };
};

export default function TimerMapping({ assignments = [], initialMap, isObstacleSafetyActive = false, onDeliveryStatusChanged, onDestinationWaitingChange, onMapSaved, onMapsChanged, onNotice, savedMaps }) {
  const initialEditor = useMemo(
    () => buildInitialEditor(savedMaps, initialMap),
    [initialMap, savedMaps],
  );
  const [selectedMapId, setSelectedMapId] = useState(initialEditor.selectedMapId);
  const [mapName, setMapName] = useState(initialEditor.mapName);
  const [steps, setSteps] = useState(initialEditor.steps);
  const [returnSteps, setReturnSteps] = useState(initialEditor.returnSteps);
  const [routePhase, setRoutePhase] = useState('outbound');
  const [returnDelaySeconds, setReturnDelaySeconds] = useState(initialEditor.returnDelaySeconds);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeIndex, setActiveIndex] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [currentCode, setCurrentCode] = useState('S');
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [runningMode, setRunningMode] = useState(null);
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);
  const runningRef = useRef(false);
  const recordingRef = useRef(null);
  const assignmentsRef = useRef(assignments);
  const currentCodeRef = useRef('S');
  const countdownRef = useRef({ active: false, deadline: 0, onComplete: null, paused: false, remainingMs: 0 });

  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  useEffect(() => () => {
    window.clearTimeout(timeoutRef.current);
    window.clearInterval(intervalRef.current);
    runningRef.current = false;
    recordingRef.current = null;
    setRunningMode(null);
    onDestinationWaitingChange?.(false);
    writeDirection('S').catch(() => {});
  }, [onDestinationWaitingChange]);

  const activeSteps = routePhase === 'outbound' ? steps : returnSteps;
  const setActiveSteps = routePhase === 'outbound' ? setSteps : setReturnSteps;
  const validSteps = useMemo(() => getValidRunnableSteps(activeSteps), [activeSteps]);

  const totalDuration = useMemo(() => getTotalDuration(steps), [steps]);
  const returnDuration = useMemo(() => getTotalDuration(returnSteps), [returnSteps]);
  const selectedMap = savedMaps.find((map) => map.id === selectedMapId);
  const availableDeliveries = assignments.filter(
    (assignment) =>
      assignment.routeMapId === selectedMapId &&
      !['returned'].includes(assignment.status),
  );

  const updateDeliveryStatus = async (status, extra = {}) => {
    if (!selectedDeliveryId) return;
    const updates = {
      status,
      statusUpdatedAt: new Date().toLocaleString(),
      ...extra,
    };
    await updateRecord('assignments', selectedDeliveryId, updates);
    onDeliveryStatusChanged?.(selectedDeliveryId, updates);
  };

  const selectMap = async (map) => {
    if (isRunning) {
      return;
    }

    setSelectedMapId(map.id);
    setMapName(map.name || 'Saved Map');
    setSteps(map.steps?.length ? map.steps : []);
    setReturnSteps(map.returnSteps?.length ? map.returnSteps : []);
    setReturnDelaySeconds(Number(map.returnDelaySeconds) || 30);
    setRoutePhase('outbound');
    setSelectedDeliveryId('');

    setIsApplying(true);

    try {
      await updateRecord('timerMap', 'current', map);
      onMapSaved(map);
      onNotice(`${map.name} applied as current timer map`);
    } catch (error) {
      onNotice(`Could not apply timer map: ${error.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleMapSelection = (event) => {
    const nextMap = savedMaps.find((map) => map.id === event.target.value);

    if (nextMap) {
      selectMap(nextMap);
    }
  };

  const createNewMap = () => {
    if (isRunning) {
      return;
    }

    setSelectedMapId('');
    setMapName(`Map ${savedMaps.length + 1}`);
    setSteps([]);
    setReturnSteps([]);
    setReturnDelaySeconds(30);
    setRoutePhase('outbound');
    setSelectedDeliveryId('');
  };

  const addStep = () => {
    setActiveSteps((currentSteps) => [...currentSteps, createStep()]);
  };

  const removeStep = (stepId) => {
    setActiveSteps((currentSteps) => currentSteps.filter((step) => step.id !== stepId));
  };

  const generateReturnPath = () => {
    const generatedSteps = [...steps].reverse().map((step) => ({
      ...step,
      id: createStep().id,
      direction: oppositeDirection[step.direction] || 'stop',
    }));

    if (generatedSteps.length === 0) {
      onNotice('Record the outbound path before generating the return path.');
      return;
    }

    setReturnSteps(generatedSteps);
    setRoutePhase('return');
    onNotice('Opposite return path generated from the outbound route. Save the map to apply it.');
  };

  const upsertSavedMap = (savedMap) => {
    const nextMaps = [
      savedMap,
      ...savedMaps.filter((map) => map.id !== savedMap.id),
    ].sort((first, second) => (second.updatedAtMs || 0) - (first.updatedAtMs || 0));

    onMapsChanged(nextMaps);
  };

  const handleSaveMap = async (nextSteps = activeSteps) => {
    const activeMapSteps = Array.isArray(nextSteps) ? nextSteps : activeSteps;
    const mapSteps = routePhase === 'outbound' ? activeMapSteps : steps;
    const mapReturnSteps = routePhase === 'return' ? activeMapSteps : returnSteps;
    const mapDuration = getTotalDuration(mapSteps);
    const mapReturnDuration = getTotalDuration(mapReturnSteps);
    const trimmedName = mapName.trim();

    if (!trimmedName) {
      onNotice('Enter a map name before saving');
      return null;
    }

    if (getValidRunnableSteps(mapSteps).length === 0) {
      onNotice('Add at least one direction with duration greater than 0');
      return null;
    }

    const mapId = selectedMapId || createMapId();
    const updatedAt = new Date();
    const savedMap = {
      id: mapId,
      name: trimmedName,
      steps: mapSteps,
      totalDuration: mapDuration,
      returnSteps: mapReturnSteps,
      returnDuration: mapReturnDuration,
      returnDelaySeconds: Math.max(1, Number(returnDelaySeconds) || 30),
      updatedAt: updatedAt.toLocaleString(),
      updatedAtMs: updatedAt.getTime(),
    };

    setIsSaving(true);

    try {
      await Promise.all([
        saveRecord('timerMaps', savedMap),
        updateRecord('timerMap', 'current', savedMap),
      ]);
      setSelectedMapId(mapId);
      onMapSaved(savedMap);
      upsertSavedMap(savedMap);
      onNotice(`${savedMap.name} saved`);
      return savedMap;
    } catch (error) {
      onNotice(`Timer map save failed: ${error.message}`);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveButton = () => {
    handleSaveMap();
  };

  const deleteMap = async (mapId) => {
    if (isRunning) {
      return;
    }

    try {
      await deleteRecord('timerMaps', mapId);
      const nextMaps = savedMaps.filter((map) => map.id !== mapId);
      onMapsChanged(nextMaps);

      if (selectedMapId === mapId) {
        const nextMap = nextMaps[0];
        if (nextMap) {
          await selectMap(nextMap);
        } else {
          createNewMap();
        }
      }

      onNotice('Saved timer map removed');
    } catch (error) {
      onNotice(`Could not delete timer map: ${error.message}`);
    }
  };

  const finishRun = async (message = 'Timer map completed') => {
    runningRef.current = false;
    window.clearTimeout(timeoutRef.current);
    window.clearInterval(intervalRef.current);
    setIsRunning(false);
    setRunningMode(null);
    setActiveIndex(null);
    setRemainingSeconds(0);
    setCurrentCode('S');
    currentCodeRef.current = 'S';
    countdownRef.current = { active: false, deadline: 0, onComplete: null, paused: false, remainingMs: 0 };
    recordingRef.current = null;
    onDestinationWaitingChange?.(false);

    try {
      await writeDirection('S');
      onNotice(`${message}; direction set to S`);
    } catch (error) {
      onNotice(`Could not send stop direction: ${error.message}`);
    }
  };

  const startCountdown = (durationMs, onComplete) => {
    window.clearTimeout(timeoutRef.current);
    window.clearInterval(intervalRef.current);
    const safeDuration = Math.max(0, durationMs);
    countdownRef.current = {
      active: true,
      deadline: Date.now() + safeDuration,
      onComplete,
      paused: isObstacleSafetyActive,
      remainingMs: safeDuration,
    };
    setRemainingSeconds(Math.ceil(safeDuration / 1000));

    if (isObstacleSafetyActive) {
      return;
    }

    intervalRef.current = window.setInterval(() => {
      const remainingMs = Math.max(0, countdownRef.current.deadline - Date.now());
      countdownRef.current.remainingMs = remainingMs;
      setRemainingSeconds(Math.ceil(remainingMs / 1000));
    }, 250);

    timeoutRef.current = window.setTimeout(() => {
      window.clearInterval(intervalRef.current);
      countdownRef.current.active = false;
      setRemainingSeconds(0);
      onComplete();
    }, safeDuration);
  };

  useEffect(() => {
    const countdown = countdownRef.current;
    if (!runningRef.current || !countdown.active) {
      return;
    }

    if (isObstacleSafetyActive && !countdown.paused) {
      countdown.remainingMs = Math.max(0, countdown.deadline - Date.now());
      countdown.paused = true;
      window.clearTimeout(timeoutRef.current);
      window.clearInterval(intervalRef.current);
      setRemainingSeconds(Math.ceil(countdown.remainingMs / 1000));
      writeDirection('S').catch(() => {});
      onNotice('Obstacle detected: route direction set to S and timer paused.');
      return;
    }

    if (!isObstacleSafetyActive && countdown.paused) {
      const { onComplete, remainingMs } = countdown;
      countdown.paused = false;
      writeDirection(currentCodeRef.current)
        .then(() => {
          startCountdown(remainingMs, onComplete);
          onNotice(`Obstacle cleared: direction ${currentCodeRef.current} restored and timer resumed.`);
        })
        .catch((error) => onNotice(`Could not resume route: ${error.message}`));
    }
  }, [isObstacleSafetyActive]);

  const sendTimedStep = async (step, index, onComplete) => {
    setActiveIndex(index);
    setCurrentCode(step.code);
    currentCodeRef.current = step.code;
    setRemainingSeconds(step.duration);

    try {
      await writeDirection(step.code);
    } catch (error) {
      onNotice(`Direction send failed: ${error.message}`);
      await finishRun('Timer map stopped');
      return;
    }

    startCountdown(step.duration * 1000, onComplete);
  };

  const runSequence = async (sequence, index, onComplete) => {
    if (!runningRef.current) {
      return;
    }

    const step = sequence[index];

    if (!step) {
      await onComplete();
      return;
    }

    await sendTimedStep(step, step.originalIndex, () => {
      runSequence(sequence, index + 1, onComplete);
    });
  };

  const waitAndRunReturn = async (savedMap) => {
    const delay = Math.max(1, Number(savedMap.returnDelaySeconds) || 30);
    const savedReturnSteps = getValidRunnableSteps(savedMap.returnSteps || []);
    setRunningMode('waiting_return');
    setActiveIndex(null);
    setCurrentCode('S');
    currentCodeRef.current = 'S';
    setRemainingSeconds(delay);
    onDestinationWaitingChange?.(true);
    await writeDirection('S');
    await updateDeliveryStatus('arrived', { arrivedAt: new Date().toLocaleString() });
    onNotice(`Outbound path complete. Waiting ${delay} seconds before automatic return.`);

    const beginReturnAfterCollection = async () => {
      if (!runningRef.current) return;
      const delivery = assignmentsRef.current.find((item) => item.id === selectedDeliveryId);
      if (selectedDeliveryId && delivery?.deliveryConfirmation !== 'collected') {
        setRunningMode('waiting_collection');
        setRemainingSeconds(0);
        onNotice('Destination wait complete. Robot remains stopped until item collection is confirmed.');
        timeoutRef.current = window.setTimeout(beginReturnAfterCollection, 2000);
        return;
      }
      window.clearInterval(intervalRef.current);
      onDestinationWaitingChange?.(false);
      await updateDeliveryStatus('returning', { returnStartedAt: new Date().toLocaleString() });
      setRoutePhase('return');
      setRunningMode('return_route');
      runSequence(savedReturnSteps, 0, async () => {
        await updateDeliveryStatus('returned', { returnedAt: new Date().toLocaleString() });
        await finishRun('Round trip complete at starting point');
      });
    };

    startCountdown(delay * 1000, beginReturnAfterCollection);
  };

  const startRun = async () => {
    const outboundSequence = getValidRunnableSteps(steps);
    const returnSequence = getValidRunnableSteps(returnSteps);

    if (outboundSequence.length === 0 || returnSequence.length === 0) {
      onNotice('Generate and save both outbound and return paths before starting the full route.');
      return;
    }
    onNotice('Starting full delivery route...');
    onDestinationWaitingChange?.(false);

    try {
      const saved = await handleSaveMap();
      if (!saved) {
        return;
      }

      await updateDeliveryStatus('in_transit', { startedAt: new Date().toLocaleString() });
      runningRef.current = true;
      setIsRunning(true);
      setRoutePhase('outbound');
      setRunningMode('outbound_route');
      await runSequence(
        getValidRunnableSteps(saved.steps || []),
        0,
        () => waitAndRunReturn(saved),
      );
    } catch (error) {
      runningRef.current = false;
      setIsRunning(false);
      setRunningMode(null);
      setActiveIndex(null);
      setCurrentCode('S');
      onNotice(`Could not start full delivery route: ${error.message}`);
    }
  };

  const startDirectionTimer = async (step, index, nextSteps) => {
    const timedStep = getRunnableStep(step, index);
    const startedAtMs = new Date().getTime();

    runningRef.current = true;
    recordingRef.current = {
      direction: timedStep.direction,
      index,
      startedAtMs,
      stepId: timedStep.id,
    };
    setIsRunning(true);
    setRunningMode('recording');
    setActiveIndex(index);
    setCurrentCode(timedStep.code);
    currentCodeRef.current = timedStep.code;
    setRemainingSeconds(0);

    try {
      await updateRecord('timerMap', 'current', {
        id: selectedMapId || '',
        name: mapName.trim() || 'Unsaved Map',
        steps: routePhase === 'outbound' ? nextSteps : steps,
        totalDuration: getTotalDuration(routePhase === 'outbound' ? nextSteps : steps),
        returnSteps: routePhase === 'return' ? nextSteps : returnSteps,
        returnDuration: getTotalDuration(routePhase === 'return' ? nextSteps : returnSteps),
        returnDelaySeconds: Math.max(1, Number(returnDelaySeconds) || 30),
      });
      await writeDirection(timedStep.code);
      onNotice(`${getDirection(timedStep.direction)?.label || 'Direction'} timer started`);
    } catch (error) {
      onNotice(`Direction timer failed: ${error.message}`);
      await finishRun('Timer map stopped');
      return;
    }

    window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.round((new Date().getTime() - startedAtMs) / 1000));
      setRemainingSeconds(elapsedSeconds);
    }, 1000);
  };

  const handleDirectionChange = async (step, index, directionValue) => {
    if (isRunning) {
      return;
    }

    if (!directionValue) {
      return;
    }

    const nextStep = {
      ...step,
      direction: directionValue,
      duration: 0,
    };
    const nextSteps = activeSteps.map((currentStep) =>
      currentStep.id === step.id ? nextStep : currentStep,
    );

    setActiveSteps(nextSteps);
    await startDirectionTimer(nextStep, index, nextSteps);
  };

  const stopRun = async () => {
    if (runningMode === 'recording' && recordingRef.current) {
      const elapsedSeconds = Math.max(
        1,
        Math.round((new Date().getTime() - recordingRef.current.startedAtMs) / 1000),
      );
      const recordedDirection = recordingRef.current.direction;
      const recordedStepId = recordingRef.current.stepId;
      const nextSteps = activeSteps.map((step) =>
        step.id === recordedStepId
          ? {
              ...step,
              direction: recordedDirection,
              duration: elapsedSeconds,
            }
          : step,
      );

      setActiveSteps(nextSteps);
      window.clearTimeout(timeoutRef.current);
      window.clearInterval(intervalRef.current);
      runningRef.current = false;
      recordingRef.current = null;
      setIsRunning(false);
      setRunningMode(null);
      setActiveIndex(null);
      setRemainingSeconds(0);
      setCurrentCode('S');

      try {
        await writeDirection('S');
        await handleSaveMap(nextSteps);
        onNotice(`${getDirection(recordedDirection)?.label || 'Direction'} duration saved as ${elapsedSeconds}s`);
      } catch (error) {
        onNotice(`Could not stop timer: ${error.message}`);
      }
      return;
    }

    finishRun('Timer map stopped');
  };

  return (
    <section className="mapping-panel">
      <div className="mapping-header">
        <div>
          <h2>Timer-Based Mapping System</h2>
          <p>Record separate outbound and return paths for every delivery location.</p>
        </div>
        <div className="direction-readout">
          <span>Firebase direction</span>
          <strong>{currentCode}</strong>
        </div>
      </div>

      <div className="saved-map-layout">
        <aside className="saved-map-list">
          <div className="saved-map-heading">
            <div>
              <strong>Saved Maps</strong>
              <span>{savedMaps.length} route(s)</span>
            </div>
            <button className="secondary-btn" disabled={isRunning || isApplying} onClick={createNewMap} type="button">
              New Map
            </button>
          </div>

          {savedMaps.length === 0 ? (
            <p className="empty-state compact">No saved timer maps yet.</p>
          ) : (
            savedMaps.map((map) => (
              <div className={`saved-map-item ${selectedMapId === map.id ? 'active' : ''}`} key={map.id}>
                <button disabled={isRunning || isApplying} onClick={() => selectMap(map)} type="button">
                  <strong>{map.name}</strong>
                  <span>Out: {map.steps?.length || 0} steps/{map.totalDuration || 0}s · Return: {map.returnSteps?.length || 0} steps/{map.returnDuration || 0}s</span>
                  <small>{map.updatedAt || 'Not updated'}</small>
                </button>
                <button
                  aria-label={`Delete ${map.name}`}
                  className="icon-btn danger"
                  disabled={isRunning || isApplying}
                  onClick={() => deleteMap(map.id)}
                  type="button"
                >
                  X
                </button>
              </div>
            ))
          )}
        </aside>

        <div className="mapping-workspace">
          <div className="map-fields">
            <label className="map-name-field" htmlFor="timerMapSelect">
              <span>Select Map Name</span>
              <select
                disabled={isRunning || isApplying || savedMaps.length === 0}
                id="timerMapSelect"
                onChange={handleMapSelection}
                value={selectedMapId}
              >
                <option value="">
                  {savedMaps.length === 0 ? 'No saved maps' : 'Select a map'}
                </option>
                {savedMaps.length > 0 &&
                  savedMaps.map((map) => (
                    <option key={map.id} value={map.id}>
                      {map.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="map-name-field" htmlFor="timerMapName">
              <span>{selectedMap ? 'Edit Map Name' : 'New Map Name'}</span>
              <input
                disabled={isRunning}
                id="timerMapName"
                onChange={(event) => setMapName(event.target.value)}
                placeholder="Office to Receiver"
                type="text"
                value={mapName}
              />
            </label>
          </div>

          <label className="map-name-field route-delivery-field" htmlFor="routeDeliverySelect">
            <span>Delivery Queue Entry</span>
            <select
              disabled={isRunning || !selectedMapId}
              id="routeDeliverySelect"
              onChange={(event) => setSelectedDeliveryId(event.target.value)}
              value={selectedDeliveryId}
            >
              <option value="">Select delivery to update</option>
              {availableDeliveries.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.id} - {assignment.receiverName} - {assignment.parcelDescription}
                </option>
              ))}
            </select>
          </label>

          <div className="route-phase-switch" role="tablist" aria-label="Route path editor">
            <button className={routePhase === 'outbound' ? 'active' : ''} disabled={isRunning} onClick={() => setRoutePhase('outbound')} role="tab" type="button">
              Outbound Path <small>Start → Destination</small>
            </button>
            <button className={routePhase === 'return' ? 'active' : ''} disabled={isRunning} onClick={() => setRoutePhase('return')} role="tab" type="button">
              Return Path <small>Destination → Start</small>
            </button>
          </div>

          <div className="generate-return-row">
            <button className="secondary-btn" disabled={isRunning || steps.length === 0} onClick={generateReturnPath} type="button">
              Generate Opposite Return Path
            </button>
            <span>Reverses the step order and swaps Forward/Backward and Left/Right while keeping the same timings.</span>
          </div>

          <label className="return-delay-field" htmlFor="returnDelaySeconds">
            <span>Wait at Destination Before Automatic Return</span>
            <div>
              <input
                disabled={isRunning}
                id="returnDelaySeconds"
                min="1"
                onChange={(event) => setReturnDelaySeconds(event.target.value)}
                type="number"
                value={returnDelaySeconds}
              />
              <strong>seconds</strong>
            </div>
          </label>

          <div className="mapping-grid">
            <div className="mapping-editor">
              <h3>{routePhase === 'outbound' ? 'Outbound Path' : 'Return Path'}</h3>
              <div className="mapping-row mapping-row-head">
                <span>Direction</span>
                <span>Code</span>
                <span>Duration</span>
                <span></span>
              </div>
              {activeSteps.length === 0 && (
                <p className="empty-state compact">No {routePhase} steps. Click Add Step and record the real path.</p>
              )}
              {activeSteps.map((step, index) => {
                const direction = getDirection(step.direction);
                const isActive = activeIndex === index;

                return (
                  <div className={`mapping-row ${isActive ? 'active' : ''}`} key={step.id}>
                    <select
                      disabled={isRunning}
                      onChange={(event) => handleDirectionChange(step, index, event.target.value)}
                      value={step.direction}
                    >
                      <option disabled value="">Select direction</option>
                      {directionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <strong>{direction?.code || '-'}</strong>
                    <span className="recorded-duration">
                      {isActive && runningMode === 'recording' ? remainingSeconds : Number(step.duration) || 0}
                      <small>sec</small>
                    </span>
                    <button
                      className="icon-btn danger"
                      disabled={isRunning}
                      onClick={() => removeStep(step.id)}
                      type="button"
                    >
                      X
                    </button>
                  </div>
                );
              })}
              <button className="secondary-btn" disabled={isRunning} onClick={addStep} type="button">
                Add Step
              </button>
            </div>

            <aside className="mapping-status">
              <div>
                <span>Status</span>
                <strong>
                  {isRunning
                    ? isObstacleSafetyActive
                      ? 'Paused for obstacle'
                      : runningMode === 'recording'
                      ? 'Recording duration'
                      : runningMode === 'waiting_return'
                        ? 'Waiting at destination'
                        : runningMode === 'waiting_collection'
                          ? 'Waiting for item collection'
                        : runningMode === 'return_route'
                          ? 'Returning to start'
                          : 'Travelling to destination'
                    : isApplying
                      ? 'Applying map'
                      : 'Ready'}
                </strong>
              </div>
              <div>
                <span>{routePhase === 'outbound' ? 'Outbound' : 'Return'} Duration</span>
                <strong>{routePhase === 'outbound' ? totalDuration : returnDuration}s</strong>
              </div>
              <div>
                <span>Current Step</span>
                <strong>
                  {activeIndex === null
                    ? 'None'
                    : `${activeIndex + 1} of ${runningMode === 'recording' ? activeSteps.length : validSteps.length}`}
                </strong>
              </div>
              <div>
                <span>{runningMode === 'recording' ? 'Timer' : 'Remaining'}</span>
                <strong>{runningMode === 'recording' ? `${remainingSeconds}s recorded` : `${remainingSeconds}s`}</strong>
              </div>
              <div className="mapping-actions">
                {isRunning ? (
                  <button className="control-btn stop active" onClick={stopRun} type="button">
                    {runningMode === 'recording' ? 'Stop Timer' : 'Stop Route'}
                  </button>
                ) : (
                  <button className="control-btn start active" disabled={isSaving} onClick={startRun} type="button">
                    {isSaving ? 'Saving...' : 'Start Full Delivery Route'}
                  </button>
                )}
                <button className="secondary-btn" disabled={isRunning || isSaving || isApplying} onClick={handleSaveButton} type="button">
                  {isApplying ? 'Applying...' : 'Save Map'}
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
