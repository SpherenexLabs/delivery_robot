const priorityLabels = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export default function ParcelList({ assignedParcelIds, parcels, onDelete }) {
  if (parcels.length === 0) {
    return <p className="empty-state">No parcel details added yet.</p>;
  }

  return (
    <div className="parcels-grid">
      {parcels.map((parcel) => {
        const isAssigned = assignedParcelIds.has(parcel.id);

        return (
          <article key={parcel.id} className="parcel-card">
            <div className="card-header">
              <div>
                <span className="record-id">{parcel.id}</span>
                <h3>{parcel.description}</h3>
              </div>
              <button
                aria-label={`Delete parcel ${parcel.id}`}
                className="icon-btn danger"
                onClick={() => onDelete(parcel.id)}
                title="Delete parcel"
                type="button"
              >
                X
              </button>
            </div>

            <div className="meta-row">
              <span className={`priority-badge ${parcel.priority}`}>{priorityLabels[parcel.priority]}</span>
              <span className={`status-badge ${isAssigned ? 'assigned' : 'ready'}`}>
                {isAssigned ? 'Assigned' : 'Ready'}
              </span>
            </div>

            <dl className="detail-list">
              <div>
                <dt>Category</dt>
                <dd>{parcel.category}</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{parcel.weight} kg</dd>
              </div>
              {(parcel.length || parcel.width || parcel.height) && (
                <div>
                  <dt>Size</dt>
                  <dd>
                    {parcel.length || '-'} x {parcel.width || '-'} x {parcel.height || '-'} cm
                  </dd>
                </div>
              )}
            </dl>

            {parcel.handlingNotes && <p className="notes">{parcel.handlingNotes}</p>}
            <p className="created-at">Added {parcel.createdAt}</p>
          </article>
        );
      })}
    </div>
  );
}
