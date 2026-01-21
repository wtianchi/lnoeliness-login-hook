import axios from "axios"
import { jwtDecode } from "jwt-decode";
import { MongoClient, ServerApiVersion } from "mongodb";
import AWS from 'aws-sdk'
import { CognitoJwtVerifier } from 'aws-jwt-verify';


const cognito = new AWS.CognitoIdentityServiceProvider({apiVersion: '2016-04-18'})
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
await client.connect();
let db = await client.db(process.env.DB).collection("users")

export const handler = async (event) => {
  // TODO implement
  let param = new URLSearchParams();
  param.append("code",event.queryStringParameters.code);
  param.append("grant_type", "authorization_code");
  param.append("client_id", process.env.CLIENT_ID);
  param.append("redirect_uri", process.env.REDIRECT_URI);
  param.append("client_secret", process.env.CLIENT_SECRET);
  try {
    const authResponse = await axios.post(process.env.AUTH_URI, param);
    const user = jwtDecode(authResponse.data.id_token);
    if (user.iss !== process.env.ISS) {
      throw new Error("Invalid issuer");
    }
    const userPoolId = process.env.POOL_ID;
    const verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'access', // or 'id' for ID tokens
      clientId: process.env.CLIENT_ID, // Optional, only if you need to verify the token audience
    });

    const payload = await verifier.verify(authResponse.data.access_token);
    if (!payload || payload.exp <= payload.auth_time) {
      throw new Error("Invalid token");
    }
    var innerUser = await db.findOne({$or: [{ id: user.sub }, {email: user.email}]});
    var resu = {};
    if(innerUser) {
      innerUser = await db.findOneAndUpdate({ id: user.sub }, { $set: {last_login: new Date().getTime().toString(), access_token: authResponse.data.access_token, auth_exp: payload.exp.toString()}});
      resu = innerUser;
      resu.new_user = false;
    }
    else{
      

      const u = await cognito.getUser({
        AccessToken: authResponse.data.access_token
      }).promise();
      resu = {
        id: user.sub,
        email: user.email,
        name: getAttribute(u.UserAttributes, "name"),
        email_verified: user.email_verified,
        phone_number: user.phone_number,
        phone_number_verified: user.phone_number_verified,
        nickname: getAttribute(u.UserAttributes, "nickname"),
        address: getAttribute(u.UserAttributes, "address"),
        gender: getAttribute(u.UserAttributes, "gender"),
        birthdate: getAttribute(u.UserAttributes, "birthdate"),
        pic:"https://loneliness-user-img.s3.ca-central-1.amazonaws.com/default.png",
        following:[],
        watching_categories:[],
        auth_exp: user.exp.toString(),
        access_token: authResponse.data.access_token,
        last_login: new Date().getTime().toString(),
        created_at: new Date().getTime().toString(),
        locked:0,
      }
      let res = await db.insertOne(resu);
      resu.new_user = true;
      delete resu.access_token;
    }
    
    let resBody = {
      id: user.sub,
      status: 1, 
      token: authResponse.data,
      user_raw: user,
      user: resu
    }
    
    const response = {
      statusCode: 200,
      body: JSON.stringify(resBody),
    };
    return response;
  } catch (error) {
    
    console.log(error);
    const response = {
      statusCode: 500,
      body: JSON.stringify(error),
    };
    
    return response;
  }
  finally {
    //await client.close();
  }
};

function getAttribute(attributes, name) {
  return attributes.find((x) => x.Name === name).Value;
}
