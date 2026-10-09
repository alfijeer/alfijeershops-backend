const mongoose = require('mongoose');

// Used to atomically hand out the next permanent shop number.
// Shop numbers must never repeat or be reused, even if a seller is later
// rejected/suspended/deleted — see Seller Rules & Standards ("non-transferable").
const counterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

async function getNextSequence(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );
  return counter.value;
}

module.exports = { Counter, getNextSequence };
