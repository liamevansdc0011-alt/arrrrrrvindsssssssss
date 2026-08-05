import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const SITE_PASSWORD = process.env.SITE_PASSWORD || "##";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const activeSessions = {
  stop: false
};

const transporters = new Map();


/*
==================================================
TRANSPORTER POOL
==================================================
*/

function getTransporter(email, appPassword) {

  const cleanEmail = email.toLowerCase().trim();

  const key = `${cleanEmail}_${appPassword}`;

  if (!transporters.has(key)) {

    const transporter = nodemailer.createTransport({

      service: "gmail",

      auth: {
        user: cleanEmail,
        pass: appPassword
      },

      pool: true,

      maxConnections: 2,

      maxMessages: Infinity,

      socketTimeout: 60000,

      connectionTimeout: 30000,

      greetingTimeout: 30000

    });


    transporters.set(key, transporter);

  }


  return transporters.get(key);

}



/*
==================================================
HELPERS
==================================================
*/


const sleep = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));



function parseSpintax(text = "") {

  const regex = /{([^{}]+)}/g;

  let result = text;

  let count = 0;


  while(regex.test(result) && count < 10){

    result = result.replace(
      regex,
      (_, options)=>{

        const arr = options.split("|");

        return arr[
          Math.floor(Math.random()*arr.length)
        ];

      }
    );

    count++;

  }


  return result;

}




function htmlToText(html = "") {

return html

.replace(/<style[\s\S]*?<\/style>/gi,"")

.replace(/<script[\s\S]*?<\/script>/gi,"")

.replace(/<br\s*\/?>/gi,"\n")

.replace(/<\/p>/gi,"\n\n")

.replace(/<[^>]+>/g,"")

.replace(/&nbsp;/g," ")

.replace(/&amp;/g,"&")

.trim();

}





/*
==================================================
PASSWORD LOGIN
==================================================
*/


app.post("/api/auth",(req,res)=>{


const {password}=req.body;


if(password===SITE_PASSWORD){

return res.json({
success:true
});

}


res.status(401).json({

success:false,

message:"Wrong password"

});


});






/*
==================================================
SMTP VERIFY
==================================================
*/


app.post("/api/verify",async(req,res)=>{


const {
email,
appPassword
}=req.body;



if(!email || !appPassword){

return res.status(400).json({

success:false,

message:"Credentials missing"

});

}



try{


const transporter =
getTransporter(email,appPassword);



await transporter.verify();



res.json({

success:true,

message:"SMTP Connected"

});



}catch(error){


res.status(401).json({

success:false,

message:"SMTP verification failed"

});


}



});








/*
==================================================
SEND EMAIL STREAM
==================================================
*/


app.post("/api/send-stream",async(req,res)=>{


res.setHeader(
"Content-Type",
"text/event-stream"
);

res.setHeader(
"Cache-Control",
"no-cache"
);

res.setHeader(
"Connection",
"keep-alive"
);


const {

email,

appPassword,

senderName,

subject,

messageBody,

recipients

}=req.body;




if(
!email ||
!appPassword ||
!Array.isArray(recipients) ||
recipients.length===0
){

res.write(
`data:${JSON.stringify({
success:false,
error:"Invalid data"
})}\n\n`
);


return res.end();

}





activeSessions.stop=false;



const transporter =
getTransporter(
email,
appPassword
);



const sender =
email.toLowerCase().trim();



for(
let i=0;
i<recipients.length;
i++
){



if(activeSessions.stop){


res.write(
`data:${JSON.stringify({
success:false,
error:"Stopped"
})}\n\n`
);


break;


}




const receiver =
recipients[i].trim();



if(!receiver)
continue;




try{


const finalSubject =
parseSpintax(subject);



const finalBody =
parseSpintax(messageBody);



const isHTML =
/<[a-z][\s\S]*>/i.test(finalBody);



const mail={


from:
senderName
?
`"${senderName}" <${sender}>`
:
sender,


to:receiver,


subject:finalSubject



};



if(isHTML){


mail.html=finalBody;

mail.text=htmlToText(finalBody);


}else{


mail.text=finalBody;


}



await transporter.sendMail(mail);



res.write(
`data:${JSON.stringify({

success:true,

recipient:receiver,

index:i+1

})}\n\n`
);



}

catch(error){


res.write(
`data:${JSON.stringify({

success:false,

recipient:receiver,

error:error.message

})}\n\n`
);


}





// 0.5 SECOND SAFE DELAY

if(i < recipients.length-24){

await sleep(500);

}



}



res.write(
"data:[DONE]\n\n"
);


res.end();



});







/*
==================================================
STOP SENDING
==================================================
*/


app.post("/api/stop",(req,res)=>{


activeSessions.stop=true;


res.json({

success:true,

message:"Stopped"

});


});






export default app;
