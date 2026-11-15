// Validate Request: checks the JSON payload sent by Bubble (author + books). Webhook authentication
// (shared-secret header) is enforced by n8n's Header Auth credential before this node runs.
const j = $input.first().json;
const b = (j && j.body && typeof j.body === 'object') ? j.body : {};
const errors = [];

const a = (b.author && typeof b.author === 'object') ? b.author : {};
const author = {
  author_id: typeof a.author_id === 'string' ? a.author_id.trim() : '',
  name: typeof a.name === 'string' ? a.name.trim() : '',
  email: typeof a.email === 'string' ? a.email.trim() : '',
  city: typeof a.city === 'string' ? a.city.trim() : '',
};
if (!author.author_id) errors.push('author.author_id is missing');
else if (!/^AUTH\d{3,}$/.test(author.author_id)) errors.push('author.author_id has an invalid format (expected e.g. AUTH001)');
if (!author.name) errors.push('author.name is missing');

if (!Array.isArray(b.books)) errors.push('books must be a list');
const books = Array.isArray(b.books) ? b.books.filter((x) => x && typeof x === 'object') : [];

const trigger = ['Single', 'Bulk'].includes(b.trigger) ? b.trigger : 'Single';

return [{
  json: {
    valid: errors.length === 0,
    errors,
    author_id: author.author_id,
    author,
    books,
    request_id: (typeof b.request_id === 'string' && b.request_id.trim()) || `${author.author_id}-${Date.now()}`,
    trigger,
    execution_id: $execution.id,
    received_at: new Date().toISOString(),
  },
}];
