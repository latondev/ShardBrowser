import axios from 'axios';

const accountString = "LobosElfreda26@hotmail.com|4J4jP51n971c|M.C549_BAY.0.U.-Crrx3kwTlIiZUiOo9l0I3tYWz8pz97*gQa!17KgzucLPLNrbilf2LInoVLQDhSYr!n70le5Phi7RqYmEMdyGVrSq0Qbv3jCwuJ11NHf*pJs6oahcuYrQSBaxNFntlu26UTFxfeum0z9NtVhUAqCXVME*BQuAOSu9orewyAYdLt41Qq*6vrVF75s!NiGYyjlyjykI4PDy2823rCMeUrtbKEFTDAvakYcB5T6ogX8sWR7fxtzhSBAUg1!iha3HEy3yX4Tur8B8lQyzIDhcfn2uixvLx!WR460!QFfH*T4BXAQG70*T6rRZUgHPNMvmcXNPS!D4T9K*XG7M7Y!Bp9DSHFq6rpewypYMw9gEcDMD1u5OFuHfhqe47z7otZCeO9okNI0L1DE*RTsLaeC*zcanUJ25Yr43yy6Cy4Ek*YZhvSGcExglXHKEZeHuzqL87sq4yg$$|9e5f94bc-e8a4-4e73-b8be-63364c29d753|kkzwxyymdyzy@smvmail.com";

const [email, password, refreshToken, clientId, recoveryEmail] = accountString.split('|');

console.log("=== THÔNG TIN TÀI KHOẢN ===");
console.log("Email:", email);
console.log("Password:", password);
console.log("Client ID:", clientId);
console.log("Recovery Email:", recoveryEmail);
console.log("Refresh Token length:", refreshToken?.length);

async function testOAuth2() {
  console.log("\n[1] Thử đổi Refresh Token lấy Access Token qua login.microsoftonline.com...");
  try {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    // params.append('scope', 'https://graph.microsoft.com/.default');

    const res = await axios.post(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log("==> ĐỔI TOKEN THÀNH CÔNG (login.microsoftonline.com)!");
    const accessToken = res.data.access_token;
    console.log("Access Token nhận được:", accessToken.substring(0, 30) + "...");
    return accessToken;
  } catch (err) {
    console.log("Lỗi login.microsoftonline.com:", err.response?.status, err.response?.data || err.message);
  }

  console.log("\n[2] Thử đổi Refresh Token qua login.live.com/oauth20_token.srf...");
  try {
    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const res = await axios.post(
      'https://login.live.com/oauth20_token.srf',
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log("==> ĐỔI TOKEN THÀNH CÔNG (login.live.com)!");
    const accessToken = res.data.access_token;
    console.log("Access Token nhận được:", accessToken.substring(0, 30) + "...");
    return accessToken;
  } catch (err) {
    console.log("Lỗi login.live.com:", err.response?.status, err.response?.data || err.message);
  }
}

async function getEmails(accessToken) {
  if (!accessToken) return;
  console.log("\n[3] Thử đọc hòm thư qua Microsoft Graph API...");
  try {
    const res = await axios.get('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=id,from,subject,bodyPreview,receivedDateTime', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    console.log("==> LẤY DANH SÁCH EMAIL THÀNH CÔNG!");
    console.log(`Số lượng thư: ${res.data.value?.length || 0}`);
    res.data.value?.forEach((msg, idx) => {
      console.log(`\n--- Email #${idx + 1} ---`);
      console.log(`Từ: ${msg.from?.emailAddress?.name} <${msg.from?.emailAddress?.address}>`);
      console.log(`Tiêu đề: ${msg.subject}`);
      console.log(`Thời gian: ${msg.receivedDateTime}`);
      console.log(`Xem trước: ${msg.bodyPreview}`);
    });
  } catch (err) {
    console.log("Lỗi Graph API messages:", err.response?.status, err.response?.data || err.message);

    // Thử Outlook API endpoint
    try {
      console.log("\n[4] Thử đọc qua Outlook endpoint https://outlook.office.com/api/v2.0/me/messages...");
      const resOutlook = await axios.get('https://outlook.office.com/api/v2.0/me/messages?$top=10', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      console.log("==> Outlook API Thành công:", resOutlook.data);
    } catch (err2) {
      console.log("Lỗi Outlook API:", err2.response?.status, err2.response?.data || err2.message);
    }
  }
}

async function main() {
  const token = await testOAuth2();
  if (token) {
    await getEmails(token);
  }
}

main();
