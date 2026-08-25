import { useState } from 'react';

const initialFormData = {
  description: '',
  category: 'documents',
  weight: '',
  length: '',
  width: '',
  height: '',
  priority: 'normal',
  handlingNotes: '',
};

export default function ParcelForm({ isSaving, onAddParcel }) {
  const [formData, setFormData] = useState(initialFormData);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.description || !formData.weight) {
      window.alert('Please fill in package description and weight.');
      return;
    }

    if (Number(formData.weight) <= 0) {
      window.alert('Parcel weight must be greater than 0 kg.');
      return;
    }

    try {
      await onAddParcel(formData);
      setFormData(initialFormData);
    } catch {
      window.alert('Could not store this parcel in Firebase. Please check the database connection.');
    }
  };

  return (
    <form className="form parcel-form" onSubmit={handleSubmit}>
      <div className="form-row two-columns">
        <label className="form-group" htmlFor="description">
          <span>Package Description *</span>
          <input
            id="description"
            name="description"
            onChange={handleChange}
            placeholder="Documents, medicines, food order"
            type="text"
            value={formData.description}
          />
        </label>
        <label className="form-group" htmlFor="category">
          <span>Category</span>
          <select id="category" name="category" onChange={handleChange} value={formData.category}>
            <option value="documents">Documents</option>
            <option value="electronics">Electronics</option>
            <option value="medicine">Medicine</option>
            <option value="food">Food</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>

      <div className="form-row four-columns">
        <label className="form-group" htmlFor="weight">
          <span>Weight (kg) *</span>
          <input
            id="weight"
            min="0"
            name="weight"
            onChange={handleChange}
            placeholder="1.2"
            step="0.1"
            type="number"
            value={formData.weight}
          />
        </label>
        <label className="form-group" htmlFor="length">
          <span>Length (cm)</span>
          <input id="length" min="0" name="length" onChange={handleChange} placeholder="20" type="number" value={formData.length} />
        </label>
        <label className="form-group" htmlFor="width">
          <span>Width (cm)</span>
          <input id="width" min="0" name="width" onChange={handleChange} placeholder="15" type="number" value={formData.width} />
        </label>
        <label className="form-group" htmlFor="height">
          <span>Height (cm)</span>
          <input id="height" min="0" name="height" onChange={handleChange} placeholder="10" type="number" value={formData.height} />
        </label>
      </div>

      <div className="form-row two-columns">
        <label className="form-group" htmlFor="priority">
          <span>Priority</span>
          <select id="priority" name="priority" onChange={handleChange} value={formData.priority}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="form-group" htmlFor="handlingNotes">
          <span>Handling Notes</span>
          <textarea
            id="handlingNotes"
            name="handlingNotes"
            onChange={handleChange}
            placeholder="Fragile, keep upright, hand over only to receiver"
            rows="3"
            value={formData.handlingNotes}
          ></textarea>
        </label>
      </div>

      <button className="submit-btn" disabled={isSaving} type="submit">
        {isSaving ? 'Saving Parcel...' : 'Add Parcel'}
      </button>
    </form>
  );
}
