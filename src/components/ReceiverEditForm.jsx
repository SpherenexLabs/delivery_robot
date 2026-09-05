import { useState } from 'react';

export default function ReceiverEditForm({ existingReceiver, isSaving, onCancel, onSaveReceiver }) {
  const [formData, setFormData] = useState({
    name: existingReceiver?.name || '',
    phone: existingReceiver?.phone || '',
    email: existingReceiver?.email || '',
    address: existingReceiver?.address || '',
    city: existingReceiver?.city || '',
    zipCode: existingReceiver?.zipCode || '',
    accessCode: existingReceiver?.accessCode || '',
    notes: existingReceiver?.notes || '',
  });

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((currentData) => ({
      ...currentData,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.name.trim() || !formData.phone.trim() || !formData.address.trim()) {
      window.alert('Please fill in receiver name, phone number, and delivery address.');
      return;
    }

    const phoneRegex = /^[0-9+\-\s()]{7,}$/;
    if (!phoneRegex.test(formData.phone)) {
      window.alert('Please enter a valid receiver phone number.');
      return;
    }

    if (formData.accessCode && !/^\d{4,8}$/.test(formData.accessCode)) {
      window.alert('Delivery access PIN must be 4-8 digits.');
      return;
    }

    try {
      await onSaveReceiver({ ...existingReceiver, ...formData });
    } catch {
      window.alert('Could not update this receiver in Firebase. Please check the database connection.');
    }
  };

  return (
    <form className="form receiver-edit-form" onSubmit={handleSubmit}>
      <div className="form-row two-columns">
        <label className="form-group" htmlFor="editReceiverName">
          <span>Receiver Name *</span>
          <input id="editReceiverName" name="name" onChange={handleChange} placeholder="Full name" type="text" value={formData.name} />
        </label>
        <label className="form-group" htmlFor="editReceiverPhone">
          <span>Phone Number *</span>
          <input id="editReceiverPhone" name="phone" onChange={handleChange} placeholder="+91 98765 43210" type="tel" value={formData.phone} />
        </label>
      </div>

      <div className="form-row two-columns">
        <label className="form-group" htmlFor="editReceiverEmail">
          <span>Email</span>
          <input id="editReceiverEmail" name="email" onChange={handleChange} placeholder="receiver@example.com" type="email" value={formData.email} />
        </label>
        <label className="form-group" htmlFor="editReceiverZipCode">
          <span>Zip Code</span>
          <input id="editReceiverZipCode" name="zipCode" onChange={handleChange} placeholder="560001" type="text" value={formData.zipCode} />
        </label>
      </div>

      <div className="form-row two-columns">
        <label className="form-group" htmlFor="editReceiverAddress">
          <span>Delivery Address *</span>
          <input
            id="editReceiverAddress"
            name="address"
            onChange={handleChange}
            placeholder="Building, room, street, or drop point"
            type="text"
            value={formData.address}
          />
        </label>
        <label className="form-group" htmlFor="editReceiverCity">
          <span>City</span>
          <input id="editReceiverCity" name="city" onChange={handleChange} placeholder="City" type="text" value={formData.city} />
        </label>
      </div>

      <div className="form-row two-columns">
        <label className="form-group" htmlFor="editReceiverAccessCode">
          <span>Delivery Access PIN</span>
          <input
            id="editReceiverAccessCode"
            inputMode="numeric"
            maxLength="8"
            name="accessCode"
            onChange={(event) => setFormData((currentData) => ({ ...currentData, accessCode: event.target.value.replace(/\D/g, '') }))}
            placeholder="4-8 digit PIN"
            type="text"
            value={formData.accessCode}
          />
        </label>
        <label className="form-group" htmlFor="editReceiverNotes">
          <span>Notes</span>
          <input id="editReceiverNotes" name="notes" onChange={handleChange} placeholder="Delivery notes" type="text" value={formData.notes} />
        </label>
      </div>

      <div className="form-actions">
        <button className="submit-btn" disabled={isSaving} type="submit">
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
        <button className="secondary-btn" disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
