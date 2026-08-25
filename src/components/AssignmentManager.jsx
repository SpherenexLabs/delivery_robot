import { useMemo, useState } from 'react';

export default function AssignmentManager({ assignedParcelIds, isSaving, parcels, receivers, routes = [], onAssign }) {
  const [selectedParcelId, setSelectedParcelId] = useState('');
  const [selectedReceiverId, setSelectedReceiverId] = useState('');
  const [notes, setNotes] = useState('');
  const [routeMapId, setRouteMapId] = useState('');

  const availableParcels = useMemo(
    () => parcels.filter((parcel) => !assignedParcelIds.has(parcel.id)),
    [assignedParcelIds, parcels],
  );

  const selectedParcel = parcels.find((parcel) => parcel.id === selectedParcelId);
  const selectedReceiver = receivers.find((receiver) => receiver.id === selectedReceiverId);
  const receiverHasFaceRegistration = Boolean(
    selectedReceiver?.faceImage &&
      (selectedReceiver?.faceDescriptors?.length || selectedReceiver?.faceDescriptor?.length),
  );
  const canAssign = Boolean(selectedParcel && selectedReceiver && receiverHasFaceRegistration);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!selectedParcel || !selectedReceiver) {
      window.alert('Please select both a parcel and a receiver.');
      return;
    }

    if (!receiverHasFaceRegistration) {
      window.alert('Please complete face recognition registration before assigning delivery.');
      return;
    }

    const createdAtMs = Date.now();

    try {
      await onAssign({
        id: `ASG-${Date.now().toString(36).toUpperCase()}`,
        parcelId: selectedParcel.id,
        parcelDescription: selectedParcel.description,
        parcelWeight: selectedParcel.weight,
        receiverId: selectedReceiver.id,
        receiverName: selectedReceiver.name,
        receiverPhone: selectedReceiver.phone,
        receiverAddress: selectedReceiver.address,
        receiverFaceImage: selectedReceiver.faceImage,
        receiverFaceImageName: selectedReceiver.faceImageName,
        receiverFaceDescriptor: selectedReceiver.faceDescriptor,
        receiverFaceDescriptors: selectedReceiver.faceDescriptors?.length
          ? selectedReceiver.faceDescriptors
          : [selectedReceiver.faceDescriptor],
        receiverFaceRegisteredAt: selectedReceiver.faceRegisteredAt,
        status: 'pending',
        routeMapId,
        routeMapName: routes.find((route) => route.id === routeMapId)?.name || '',
        returnMode: 'reverse_outbound',
        notes,
        createdAt: new Date().toLocaleDateString(),
        createdAtMs,
      });

      setSelectedParcelId('');
      setSelectedReceiverId('');
      setNotes('');
      setRouteMapId('');
    } catch {
      window.alert('Could not store this assignment in Firebase. Please check the database connection.');
    }
  };

  return (
    <form className="form assignment-form" onSubmit={handleSubmit}>
      <div className="form-row two-columns">
        <label className="form-group" htmlFor="parcel-select">
          <span>Select Parcel *</span>
          <select
            disabled={availableParcels.length === 0}
            id="parcel-select"
            onChange={(event) => setSelectedParcelId(event.target.value)}
            value={selectedParcelId}
          >
            <option value="">Choose parcel</option>
            {availableParcels.map((parcel) => (
              <option key={parcel.id} value={parcel.id}>
                {parcel.id} - {parcel.description} ({parcel.weight} kg)
              </option>
            ))}
          </select>
        </label>

        <label className="form-group" htmlFor="receiver-select">
          <span>Select Receiver *</span>
          <select
            disabled={receivers.length === 0}
            id="receiver-select"
            onChange={(event) => setSelectedReceiverId(event.target.value)}
            value={selectedReceiverId}
          >
            <option value="">Choose receiver</option>
            {receivers.map((receiver) => (
              <option key={receiver.id} value={receiver.id}>
                {receiver.id} - {receiver.name} ({receiver.faceDescriptors?.length || receiver.faceDescriptor?.length ? 'face ready' : 'face missing'})
              </option>
            ))}
          </select>
        </label>
      </div>

      {(selectedParcel || selectedReceiver) && (
        <div className="selection-preview">
          {selectedParcel && (
            <div className="detail-box">
              <h4>Parcel Details</h4>
              <p>{selectedParcel.description}</p>
              <p>{selectedParcel.priority} priority</p>
            </div>
          )}

          {selectedReceiver && (
            <div className="detail-box">
              <h4>Receiver Details</h4>
              {selectedReceiver.faceImage && (
                <img
                  alt={`${selectedReceiver.name} face reference`}
                  className="face-thumb"
                  src={selectedReceiver.faceImage}
                />
              )}
              <p>{selectedReceiver.name}</p>
              <p>{selectedReceiver.phone}</p>
              <p>{selectedReceiver.address}</p>
              <p>
                {selectedReceiver.faceDescriptors?.length || selectedReceiver.faceDescriptor?.length
                  ? `${selectedReceiver.faceDescriptors?.length || 1} recognition sample(s)`
                  : 'Recognition data missing'}
              </p>
            </div>
          )}
        </div>
      )}

      <label className="form-group" htmlFor="assignment-notes">
        <span>Delivery Notes</span>
        <textarea
          id="assignment-notes"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Route notes, access instructions, robot handling details"
          rows="3"
          value={notes}
        ></textarea>
      </label>

      <label className="form-group" htmlFor="assignment-route">
        <span>Registered Delivery Route *</span>
        <select
          id="assignment-route"
          onChange={(event) => setRouteMapId(event.target.value)}
          value={routeMapId}
        >
          <option value="">Choose timer map</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>{route.name} ({route.totalDuration || 0}s)</option>
          ))}
        </select>
      </label>

      {availableParcels.length === 0 && (
        <p className="inline-help">Add a parcel or remove an existing assignment before assigning another delivery.</p>
      )}

      {receivers.length === 0 && <p className="inline-help">Add receiver details before creating an assignment.</p>}

      {selectedReceiver && !receiverHasFaceRegistration && (
        <p className="inline-help">This receiver needs validated face registration before the robot can authenticate delivery.</p>
      )}

      <button className="submit-btn" disabled={!canAssign || !routeMapId || isSaving} type="submit">
        {isSaving ? 'Saving Assignment...' : 'Assign Delivery'}
      </button>
    </form>
  );
}
