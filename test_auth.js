const http = require('http');

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: JSON.parse(data || '{}') });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('--- Testing Auth ---');
  const testUser = 'testuser_' + Date.now();
  
  // 1. Register
  console.log(`1. Registering ${testUser}...`);
  const regRes = await request('/api/register', 'POST', { username: testUser, password: 'password123' });
  console.log('   Status:', regRes.statusCode);
  if (regRes.statusCode !== 201) throw new Error('Registration failed');

  // 2. Login (Success)
  console.log('2. Logging in...');
  const loginRes = await request('/api/login', 'POST', { username: testUser, password: 'password123' });
  console.log('   Status:', loginRes.statusCode);
  if (loginRes.statusCode !== 200 || !loginRes.body.token) throw new Error('Login failed');
  console.log('   Token received!');

  // 3. Login (Fail)
  console.log('3. Logging in with wrong password...');
  const failRes = await request('/api/login', 'POST', { username: testUser, password: 'wrongpassword' });
  console.log('   Status:', failRes.statusCode);
  if (failRes.statusCode !== 401) throw new Error('Security check failed');

  console.log('--- ALL TESTS PASSED ---');
}

// Wait for server to start, then run
setTimeout(() => {
    test().catch(err => {
        console.error('FAILED:', err);
        process.exit(1);
    });
}, 3000);
