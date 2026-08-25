const directionButtons = [
  { code: 'F', label: 'Forward', icon: 'forward', className: 'forward' },
  { code: 'L', label: 'Left', icon: 'left', className: 'left' },
  { code: 'S', label: 'Stop', icon: 'stop', className: 'manual-stop' },
  { code: 'R', label: 'Right', icon: 'right', className: 'right' },
  { code: 'B', label: 'Backward', icon: 'backward', className: 'backward' },
];

export default function RobotControl({
  control,
  disabled,
  manualDirection,
  manualDirectionSaving,
  onManualDirection,
  onModeChange,
  onPowerChange,
}) {
  const isRunning = control.isRunning;
  const isManualMode = control.mode === 'manual';
  const manualDisabled = disabled || manualDirectionSaving || !isManualMode;

  return (
    <section className="robot-control-panel" aria-label="Robot controls">
      <div className="control-status">
        <span className={`robot-power-indicator ${isRunning ? 'running' : 'stopped'}`}></span>
        <div>
          <span className="control-label">Robot Status</span>
          <strong>{isRunning ? 'Running' : 'Stopped'}</strong>
        </div>
      </div>

      <div className="control-group">
        <span className="control-label">Power</span>
        <div className="power-actions">
          <button
            className={`control-btn start ${isRunning ? 'active' : ''}`}
            disabled={disabled || isRunning}
            onClick={() => onPowerChange(true)}
            type="button"
          >
            <ControlIcon name="power" />
            Start
          </button>
          <button
            className={`control-btn stop ${!isRunning ? 'active' : ''}`}
            disabled={disabled || !isRunning}
            onClick={() => onPowerChange(false)}
            type="button"
          >
            <ControlIcon name="stop" />
            Stop
          </button>
        </div>
      </div>

      <div className="control-group mode-control">
        <span className="control-label">Operating Mode</span>
        <div className="mode-selector" role="group" aria-label="Operating mode">
          <button
            className={control.mode === 'manual' ? 'active' : ''}
            disabled={disabled}
            onClick={() => onModeChange('manual')}
            type="button"
          >
            Manual
          </button>
          <button
            className={control.mode === 'autonomous' ? 'active' : ''}
            disabled={disabled}
            onClick={() => onModeChange('autonomous')}
            type="button"
          >
            Autonomous
          </button>
        </div>
      </div>

      <div className="manual-control-pad">
        <div className="manual-control-heading">
          <span className="control-label">Manual Movement</span>
          <strong>{isManualMode ? 'Ready' : 'Autonomous active'}</strong>
        </div>
        <div className="direction-pad" role="group" aria-label="Manual robot direction">
          {directionButtons.map((direction) => (
            <button
              className={`pad-btn ${direction.className} ${manualDirection === direction.code ? 'active' : ''}`}
              disabled={manualDisabled}
              key={direction.code}
              onClick={() => onManualDirection(direction.code)}
              title={`Send ${direction.code} to Firebase direction`}
              type="button"
            >
              <ControlIcon name={direction.icon} />
              <span>{direction.label}</span>
            </button>
          ))}
        </div>
        <span className="direction-node">Firebase direction: {manualDirection || 'S'}</span>
      </div>

      <div className="control-update">
        <span className="control-label">Current Command</span>
        <strong>{control.command.replaceAll('_', ' ')}</strong>
        <span>{control.updatedAt || 'Not sent yet'}</span>
      </div>
    </section>
  );
}

function ControlIcon({ name }) {
  const paths = {
    backward: <path d="M12 20 5 13h4V4h6v9h4l-7 7Z" />,
    forward: <path d="M12 4 5 11h4v9h6v-9h4l-7-7Z" />,
    left: <path d="M4 12 11 5v4h9v6h-9v4l-7-7Z" />,
    power: <path d="M11 2h2v10h-2V2Zm-4.6 3.6 1.4 1.4A7 7 0 1 0 16.2 7l1.4-1.4A9 9 0 1 1 6.4 5.6Z" />,
    right: <path d="m20 12-7 7v-4H4V9h9V5l7 7Z" />,
    stop: <path d="M6 6h12v12H6V6Z" />,
  };

  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
