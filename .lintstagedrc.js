const path = require('path');

module.exports = {
  'web/**/*.{ts,tsx}': () => {
    const webPath = path.join(__dirname, 'web');
    return `npx tsc --noEmit --project ${webPath}/tsconfig.json`;
  },
};
