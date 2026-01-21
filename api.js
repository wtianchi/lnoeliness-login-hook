import axios from "axios"
import { jwtDecode } from "jwt-decode";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import AWS from 'aws-sdk'
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import atob from "atob";


const cognito = new AWS.CognitoIdentityServiceProvider({apiVersion: '2016-04-18'})
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
await client.connect();
let db = await client.db(process.env.DB)

export const handler = async (event) => {
  // TODO implement
  
  try {
    var motion = undefined;
    if(event.hasOwnProperty("config") && event["config"].hasOwnProperty("headers") && event["config"]["headers"].hasOwnProperty("motion")){
      motion = event["config"]["headers"]["motion"];
      
    }
    if(motion == undefined){
      if(event.hasOwnProperty("headers") && event["headers"].hasOwnProperty("motion")){
        motion = event["headers"]["motion"];
      }
    }
    if(motion == undefined && event["queryStringParameters"] != null){
      if(event.hasOwnProperty("queryStringParameters") && event["queryStringParameters"].hasOwnProperty("motion")){
        motion = event["queryStringParameters"]["motion"];
      }
    }
    //console.log(atob(event.body));
    var resBody = {};

    if(motion == "get_user"){
      let user = await db.collection("users").findOne({$or: [{ id: user.sub }, {email: user.email}]});
      if(user){
        delete user.access_token;
        delete user.email_verified;
        delete user.phone_number_verified;
        delete user.last_login;
        delete user.watching_categories;
        delete user.auth_exp;
        resBody = user;
      }
      else{
        resBody = {status:0, error: "User not exist"};
      }
    }
    else if(motion == "get_posts"){
      let userId = getValueFromPost(event, "id");
      let cutoffTime = getValueFromPost(event, "time");
      let size = parseInt(getValueFromPost(event, "size"));
      var posts = [];
      if(userId == undefined || userId == ""){
        posts = await db.collection("posts").find(
          {
            time: { $lt: cutoffTime },
            category: "",
            group_id: ""
          }
        ).limit(size).toArray();
      }
      else{
        posts = await db.collection("posts").aggregate([
          // 0. Time filter
          {
            $match: {
              time: { $lt: cutoffTime }
            }
          },
        
          // 1. Load user (may be empty / not found)
          {
            $lookup: {
              from: "users",
              let: { uid: userId },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$id", "$$uid"] }
                  }
                },
                {
                  $project: {
                    watching_categories: 1,
                    _id: 0
                  }
                }
              ],
              as: "user"
            }
          },
        
          // 2. Load group membership for this post
          {
            $lookup: {
              from: "groups",
              let: { gid: "$group_id", uid: userId },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$_id", "$$gid"] },
                        { $in: ["$$uid", "$members.user_id"] }
                      ]
                    }
                  }
                },
                { $project: { _id: 1 } }
              ],
              as: "group"
            }
          },
        
          // 3. Unified access control
          {
            $match: {
              $expr: {
                $cond: [
                  // IF userId exists AND user document exists
                  {
                    $and: [
                      { $ne: [userId, null] },
                      { $ne: [userId, ""] },
                      { $gt: [{ $size: "$user" }, 0] }
                    ]
                  },
        
                  // THEN: category OR group OR ownership
                  {
                    $or: [
                      // CATEGORY RULE
                      {
                        $or: [
                          { $eq: ["$category", ""] },
                          {
                            $in: [
                              "$category",
                              { $arrayElemAt: ["$user.watching_categories", 0] }
                            ]
                          }
                        ]
                      },
        
                      // GROUP RULE
                      {
                        $or: [
                          { $eq: ["$group_id", ""] },
                          { $gt: [{ $size: "$group" }, 0] }
                        ]
                      },
        
                      // OWNERSHIP RULE
                      {
                        $eq: ["$poster.id", userId]
                      }
                    ]
                  },
        
                  // ELSE: user empty or not found → public only
                  {
                    $and: [
                      { $eq: ["$category", ""] },
                      { $eq: ["$group_id", ""] }
                    ]
                  }
                ]
              }
            }
          },
        
          // 4. Cleanup
          {
            $project: {
              user: 0,
              group: 0
            }
          },
        
          // 5. Sort
          {
            $sort: { time: -1 }
          }
        ]).limit(size).toArray();
      }
      if(posts.length > 0){
        resBody.results = posts;
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
    }
    else if(motion == "get_posts_by_user"){
      let userId = getValueFromPost(event, "id");
      let cutoffTime = getValueFromPost(event, "time");
      let size = parseInt(getValueFromPost(event, "size"));
      var posts = [];
      posts = await db.collection("posts").find({"poster.id": userId, "time": { $lt: cutoffTime }}).limit(size).toArray();
      
      if(posts.length > 0){
        resBody.results = posts;
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
    }
    else if(motion == "get_user_by_id"){
      let user = await db.collection("users").findOne({id: getValueFromPost(event, "id")});
      if(user){
        delete user.access_token;
        resBody = user;
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
    }
    else if(motion == "get_groups"){
      /*let groups = await db.collection("groups").aggregate( [
        {$match:{create_at:{$lt:getValueFromPost(event, "time")}}},
        {
          $lookup:
            {
              from: "posts",
              localField: "_id",
              foreignField: "group_id",
              as: "posts"
            }
       }
     ] ).limit(parseInt(getValueFromPost(event, "size"))).toArray();*/
     let groups = await db.collection("groups").find({$and: [{create_at:{$lt:getValueFromPost(event, "time")}}, {dismissed: false}]}).limit(parseInt(getValueFromPost(event, "size"))).toArray();
      if(groups.length > 0){
        resBody.results = groups;
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
    }
    else if(motion == "get_my_groups"){
      
      let groups = await db.collection("groups").find({members:{ $elemMatch: { user_id:getValueFromPost(event, "id") } }}).toArray();
      if(groups.length > 0){
        resBody.results = groups;
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
    }
    else if(motion == "get_group_by_id"){
      let groups = await db.collection("groups").aggregate( [
        {$match:{_id: new ObjectId(getValueFromPost(event, "id"))}},
        {
          $lookup:
            {
              from: "posts",
              localField: "_id",
              foreignField: "group_id",
              as: "posts"
            }
       }
     ] ).toArray();
      if(groups.length > 0){
        resBody = groups[0];
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
    }
    else if(motion == "update_profile"){
      let valid = await simpleAuth(event);
      if(valid){
        let id = getValueFromPost(event, "id");
        let address = getValueFromPost(event, "address");
        let birthdate = getValueFromPost(event, "birthdate");
        let gender = getValueFromPost(event, "gender");
        let name = getValueFromPost(event, "name");
        let phone_number = getValueFromPost(event, "phone_number");
        let following = getValueFromPost(event, "following");
        let watching_categories = getValueFromPost(event, "watching_categories");
        let query = { id: id};
        if(address != undefined && address != ""){
          query.address = address;
        }
        if(birthdate != undefined && birthdate != ""){
          query.birthdate = birthdate;
        }
        if(gender != undefined && gender != ""){
          query.gender = gender;
        }
        if(name != undefined && name != ""){
          query.name = name;
        }
        if(phone_number != undefined && phone_number != ""){
          query.phone_number = phone_number;
        }
        if(following != undefined && following != ""){
          query.following = following;
        }
        if(watching_categories != undefined && watching_categories != ""){
          query.watching_categories = watching_categories;
        }
        let user = await db.collection("users").findOneAndUpdate({id: id}, {set: query});
        if(user){
          resBody = user;
          resBody.status = 1
        }
        else{
          resBody = {status:0, error: "update failed"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "like"){
      let valid = await simpleAuth(event, db.collection("user"));
      if(valid){
        let id = getValueFromPost(event, "id");
        let post_id = new ObjectId(getValueFromPost(event, "post_id"));
        let post = await db.collection("posts").findOne({_id: post_id});
        if(post){
          var like = post.likes;
          let i = like.indexOf(id);
          if(i > -1){
            like = like.filter(item => item !== id);
          }
          else{
            like.push(id);
          }
          let up = await db.collection("posts").updateOne({_id: post_id}, {$set: {likes: like}});
          if(up){
            resBody.status = 1;
          }
        }
        else{
          resBody = {status:0, error: "failed"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "update_cat"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        let id = getValueFromPost(event, "id");
        let cat = new ObjectId(getValueFromPost(event, "cat"));
        var cats = user.watching_categories;
        let i = cats.indexOf(cat);
        if(i > -1){
          cats = cats.filter(item => item !== cat);
        }
        else{
          cats.push(cat);
        }
        let up = await db.collection("user").updateOne({id: id}, {$set: {watching_categories: cats}});
        if(up){
          resBody.status = 1;
        }
        else{
          resBody = {status:0, error: "failed"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "join_group"){
      let valid = await simpleAuth(event, db.collection("user"));
      if(valid){
        let id = getValueFromPost(event, "id");
        let group_id = new ObjectId(getValueFromPost(event, "group_id"));
        let group = await db.collection("groups").findOne({$and: [{_id: group_id}, {dismissed: false}]});
        if(group){
          var members = group.members;
          let you = members.find((x) => x.user_id == id);
          if(you == undefined){
            members.push({user_id: id, 
              name: you.name,
              nickname: you.nickname,
              pic: you.pic,
              role: "member"});
            resBody.status = 1;
          }
          else if(you.role != "owner"){
            members = members.filter(item => item !== you);
            let up = await db.collection("groups").updateOne({_id: post_id}, {$set: {members: members}});
            if(up){
              resBody.status = 1;
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          } 
          else{
            resBody = {status:0, error: "you are owner"};
          }
        }
        else{
          resBody = {status:0, error: "failed"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "get_self"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        resBody = user;
        resBody.status = 1;
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "post"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        let id = getValueFromPost(event, "id");
        var group_id = getValueFromPost(event, "group_id");
        var category = getValueFromPost(event, "category");
        if(group_id == undefined || group_id == ""){
          let group = await db.collection("groups").findOne({_id: new Object(group_id)});
          let members = group.members;
          let you = members.find((x) => x.user_id == id);
          if(!group || you == undefined){
            group_id = "";
          }
        }
        let poster = {
          id: id,
          name: user.name,
          email: user.email,
          pic: user.pic,
          nickname: user.nickname
        };

        let post = {
          poster: poster,
          group_id: group_id,
          category: category,
          text: getValueFromPost(event, "text"),
          time: new Date().getTime().toString(),
          likes: [],
          comments: [],
          file: JSON.parse(getValueFromPost(event, "file")),
          isPublic: true
        };
        let up = await db.collection("posts").insertOne(post);
        if(up){
          resBody.status = 1;
        }
        else{
          resBody = {status:0, error: "failed"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "comment"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      var group = {};
      var post = {};
      if(user){
        let id = getValueFromPost(event, "id");
        var post_id = getValueFromPost(event, "post_id");
        var group_id = getValueFromPost(event, "group_id");
        if(group_id != undefined || group_id != ""){
          group = await db.collection("groups").findOne({$and: [{_id: new Object(group_id)}, {dismissed: false}]});
          let members = group.members;
          let you = members.find((x) => x.user_id == id);
          if(!group || you == undefined){
            group_id = "";
            group = {};
          }
        }
        if(post_id != undefined || post_id != ""){
          post = await db.collection("posts").findOne({_id: new Object(post_id)});
          if(!post){
            post_id = "";
            post = {};
          }
        }
        if(group_id != "" && post_id != ""){
          resBody = {status:0, error: "can only coment to either a group or post"};
        }
        else if(post_id == "" && group_id == ""){
          resBody = {status:0, error: "must coment to a group or post"};
        }
        else{
          let comment = {
            name: user.name,
            text: getValueFromPost(event, "text"),
            time: new Date().getTime().toString(),
            pic: user.pic,
            nickname: user.nickname,
            email: user.email,
            user_id: user.id
          };
          if(group_id != ""){
            let up = await db.collection("groups").updateOne({_id: new Object(group_id)}, {$push: {comments: comment}});
            if(up){
              resBody.status = 1;
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          }
          else if(post_id != ""){
            let up = await db.collection("posts").updateOne({_id: new Object(post_id)}, {$push: {comments: comment}});
            if(up){
              resBody.status = 1;
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          }
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "create_group"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        let id = getValueFromPost(event, "id");

        let group = {
          create_at: new Date().getTime().toString(),
          members: [{user_id: id,
            name: user.name,
            nickname: user.nickname,
            pic: user.pic,
            role: "owner"}],
          name: getValueFromPost(event, "name"),
          description: getValueFromPost(event, "description"),
          pic: "",
          dismissed: false,
          announcements: [],
          comments: [],
          file: [],
          isPublic: true
        };
        let up = await db.collection("groups").insertOne(group);
        if(up){
          resBody.status = 1;
        }
        else{
          resBody = {status:0, error: "failed"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "update_group"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        let id = getValueFromPost(event, "id");
        var group_id = getValueFromPost(event, "group_id");
        let group = await db.collection("groups").findOne({_id: new Object(group_id)});
        if(group){
          let members = group.members;
          let you = members.find((x) => x.user_id == id);
          if(you != undefined && (you.role == "owner" || you.role == "administrator")){
            let query = {};
            let name = getValueFromPost(event, "name");
            let description = getValueFromPost(event, "description");
            let isPublic = getValueFromPost(event, "isPublic");
            let pic = getValueFromPost(event, "pic");
            if(name != undefined && name != ""){
              query.name = name;
            }
            if(description != undefined && description != ""){
              query.description = description;
            }
            if(isPublic != undefined && isPublic != ""){
              query.isPublic = isPublic;
            }
            if(pic != undefined && pic != ""){
              query.pic = pic;
            }
            let up = await db.collection("groups").updateOne({_id: new Object(group_id)}, {$set: query});
            if(up){
              resBody.status = 1;
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          }
          else{
            resBody = {status:0, error: "permission denied"};
          }
        }
        else{
          resBody = {status:0, error: "must update a group"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "dismiss_group"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        let id = getValueFromPost(event, "id");
        var group_id = getValueFromPost(event, "group_id");
        let group = await db.collection("groups").findOne({_id: new Object(group_id)});
        if(group){
          let members = group.members;
          let you = members.find((x) => x.user_id == id);
          if(you != undefined && (you.role == "owner")){
            let up = await db.collection("groups").updateOne({_id: new Object(group_id)}, {$set: {dismissed: true, members:[], announcements:[], file:[]}});
            if(up){
              resBody.status = 1;
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          }
          else{
            resBody = {status:0, error: "permission denied"};
          }
        }
        else{
          resBody = {status:0, error: "must dismiss a group"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else if(motion == "set_role"){
      let id = getValueFromPost(event, "id");
      let target_id = getValueFromPost(event, "target_id");
      if(id != target_id){
        let user = await simpleAuthAndGetUser(event, db.collection("user"));
        if(user){
          var group_id = getValueFromPost(event, "group_id");
          let group = await db.collection("groups").findOne({_id: new Object(group_id)});
          if(group){
            var members = group.members;
            let you = members.find((x) => x.user_id == id);
            let target = members.find((x) => x.user_id == target_id);
            if(you != undefined && target != undefined){
              if(you.role == "owner" || (you.role == "administrator" && target.role != "owner")){
                let role = getValueFromPost(event, "role");
                target.role = role;
                mamber = members.filter(item => item !== target);
                members.push(target);
                let up = await db.collection("groups").updateOne({_id: new Object(group_id)}, {$set: {members: members}});
                if(up){
                  resBody.status = 1;
                }
                else{
                  resBody = {status:0, error: "failed"};
                }
              }
              else{
                resBody = {status:0, error: "permission denied"};
              }
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          }
          else{
            resBody = {status:0, error: "group not exist"};
          }
        }
        else{
          resBody = {status:0, error: "denied"};
        }
      }
    }
    else if(motion == "announce"){
      let user = await simpleAuthAndGetUser(event, db.collection("user"));
      if(user){
        let id = getValueFromPost(event, "id");
        var group_id = getValueFromPost(event, "group_id");
        let group = await db.collection("groups").findOne({$and: [{_id: new Object(group_id)}, {dismissed: false}]});
        if(group){
          let members = group.members;
          let you = members.find((x) => x.user_id == id);
          if(you != undefined && (you.role == "owner" || you.role == "administrator")){
            let announce = {
              name: user.name,
              title: getValueFromPost(event, "title"),
              text: getValueFromPost(event, "text"),
              time: new Date().getTime().toString(),
              nickname: user.nickname,
              user_id: user.id
            };
            let up = await db.collection("groups").updateOne({_id: new Object(group_id)}, {$push: {announces: announce}});
            if(up){
              resBody.status = 1;
            }
            else{
              resBody = {status:0, error: "failed"};
            }
          }
          else{
            resBody = {status:0, error: "permission denied"};
          }
        }
        else{
          resBody = {status:0, error: "must announce in a group"};
        }
      }
      else{
        resBody = {status:0, error: "denied"};
      }
    }
    else{
      //resBody = {status:0, error: "motion not found"}
      let userId = "0c8d1598-e0e1-709f-b0dd-02dff9b928e8";
      var posts = [];
        posts = await db.collection("posts").find({"poster.id": userId, "time": { $lt: "1766675834739" }}).limit(10).toArray();
      
      if(posts.length > 0){
        resBody.l = posts.length;
        resBody.results = posts;
        resBody.status = 1
      }
      else{
        resBody = {status:0, error: "not found"};
      }
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

function etoa(e){
  var body = e.body;
  if(body == undefined){
    body = e.data.body
  }
  let text = atob(body).replaceAll("\t", "");
  var ct = e.headers["content-type"];
  if(ct == undefined){
    ct = e.headers["Content-Type"];
  }
  if(ct == undefined || ct.indexOf("boundary=") < 0){
    ct = e.data.headers["Content-Type"];
  }
  var boundary = "--" + ct.split("boundary=")[1];
  var parts = text.split(boundary);
  return parts;
}

function getValueFromPost(e, key){
  var val = undefined;
  try{
    val = e[key];
  }
  catch(error){
  }
  if(val == undefined)
  try{
    val = JSON.parse(e)[key];
  }
  catch(error){
  }
  
  if(val == undefined)
  try{
    val = e.body[key];
  }
  catch(error){

  }

  if(val == undefined)
  try{
    val = JSON.parse(e.body)[key];
  }
  catch(error){

  }
  if(val == undefined){
    try{
      if(e["queryStringParameters"] != null){
        val = e["queryStringParameters"][key];
      }
      if(val == undefined){
      var parts = etoa(e);
        for (var i = 0; i < parts.length; i++) {
          const k = "name=\"" + key + "\"";
          if(parts[i].includes(k)){
            return parts[i].split("\r\n\r\n")[1].replaceAll("\r", "").replaceAll("\n", "");
          }
        }
      }
    }
    catch(error){

    }
  }
  return val;
}

export const simpleAuth = async (e) => {
  try{
    let id = getValueFromPost(e, "id");
    let token = getValueFromPost(e, "token");
    let now = new Date().getTime();
      let innerUser = await db.collection("users").findOne({id: id});
      if(innerUser){
        if(innerUser.access_token == token && innerUser.auth_exp * 1000 > now){
          return true;
        }
        else{
          const userPoolId = process.env.POOL_ID;
          const verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: 'access', // or 'id' for ID tokens
            clientId: process.env.CLIENT_ID, // Optional, only if you need to verify the token audience
          });

          const payload = await verifier.verify(token);
          if(payload.sub == id && payload.exp * 1000 > now){
            await db.collection("users").updateOne({id: id}, {$set: {access_token: token, auth_exp: payload.exp.toString()}})
            return true;
          }
          else{
            return false;
          }
        }
      }
      else{
        return false;
      }
  }
  catch(error){
    console.log(error);
    return false;
  }
}

export const simpleAuthAndGetUser = async (e) => {
  try{
    let id = getValueFromPost(e, "id");
    let token = getValueFromPost(e, "token");
    let now = new Date().getTime();
      let innerUser = await db.collection("users").findOne({id: id});
      if(innerUser){
        if(innerUser.access_token == token && innerUser.auth_exp * 1000 > now){
          return innerUser;
        }
        else{
          const userPoolId = process.env.POOL_ID;
          const verifier = CognitoJwtVerifier.create({
            userPoolId,
            tokenUse: 'access', // or 'id' for ID tokens
            clientId: process.env.CLIENT_ID, // Optional, only if you need to verify the token audience
          });

          const payload = await verifier.verify(token);
          if(payload.sub == id && payload.exp * 1000 > now){
            await db.collection("users").updateOne({id: id}, {$set: {access_token: token, auth_exp: payload.exp.toString()}})
            return innerUser;
          }
          else{
            return false;
          }
        }
      }
      else{
        return false;
      }
  }
  catch(error){
    console.log(error);
    return false;
  }
}
