// src/index.js
var worker_default = {
  async fetch(request, env) {
    if (request.method != "POST") {
      return new Response("Method not supported", { status: 405 });
    }
    var payload = await request.json();
    const ticket_id = payload.ticket ? payload.ticket : "";
    if (ticket_id == "") {
      return new Response("No ticket ID passed", { status: 406 });
    }
    const subdomain = env.SUBDOMAIN;
    const token = env.TOKEN;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Basic " + token
    };
    let support_emails = await getSupportAddress(subdomain, headers);
    let ticket = await getTicket(ticket_id, subdomain, headers);
    let recipients = await getAudit(ticket_id, subdomain, headers);
    for (const recipient of recipients) {
      console.log(`Comparing original ${ticket.recipient} and new ${recipient}`);
      if (ticket.recipient == recipient) {
        console.log(`Skipped. Existing ticket for ${recipient}`);
      } else if (!support_emails.includes(recipient)) {
        console.log(`Skipped. ${recipient} is not a support email.`);
      } else {
        var new_ticket = await createTicket(ticket, recipient, ticket_id, subdomain, headers);
        console.log(`created ticket ${new_ticket} for ${recipient}`);
      }
    }
    return new Response(`Created tickets`);
  }
};
async function getSupportAddress(subdomain, headers) {
  const init = {
    method: "GET",
    headers
  };
  const result = await fetch("https://" + subdomain + ".zendesk.com/api/v2/recipient_addresses", init);
  let json = await result.json();
  var support_emails = [];
  for (const element of json.recipient_addresses) {
    support_emails.push(element.email);
  }
  console.log("addresses", support_emails);
  return support_emails;
}
async function getTicket(ticket_id, subdomain, headers) {
  const init = {
    method: "GET",
    headers
  };
  const result = await fetch("https://" + subdomain + ".zendesk.com/api/v2/tickets/" + ticket_id + ".json", init);
  let json = await result.json();
  console.log("ticket", json.ticket);
  return json.ticket;
}
async function getAudit(ticket_id, subdomain, headers) {
  const init = {
    method: "GET",
    headers
  };
  const result = await fetch("https://" + subdomain + ".zendesk.com/api/v2/tickets/" + ticket_id + "/audits", init);
  let json = await result.json();
  let audits = json.audits;
  for (const audit of audits) {
    if (audit.via.channel == 'email') {
      console.log(audit);
      var recipients = audit.via.source.from.original_recipients;
      console.log("recipients", recipients);
      return recipients;
    }
  }
}

async function uploadFileToZendesk(fileBuffer, fileName, contentType, subdomain, token) {

  const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/uploads.json?filename=${fileName}`, {
    method: 'POST',
    headers: {
      "Authorization": "Basic " + token,
      "Content-Type": contentType
    },
    body: fileBuffer
  });

  const data = await response.json();

  return data.upload.token;
}

async function fetchAndCloneAttachments(ticket_id, subdomain, headers) {
  const init = {
    method: "GET",
    headers
  };
  const uploadTokens = [];

  const result = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets/${ticket_id}/comments`, init);
  const json = await result.json();

  for (const comment of json.comments) {
    const attachments = comment.attachments; 
    
    if (attachments && attachments.length > 0) {

      for (const attachment of attachments) {
        const { content_url, file_name, content_type } = attachment;

        const attachmentResult = await fetch(content_url);
        const arrayBuffer = await attachmentResult.arrayBuffer();

        const uploadToken = await uploadFileToZendesk(arrayBuffer, file_name, content_type, subdomain, headers.Authorization);
        uploadTokens.push(uploadToken);

        console.log(`Archivo ${file_name} subido con éxito. Token: ${uploadToken}`);
      }
    }
  }

  return uploadTokens;
}


async function createTicket(ticket, recipient, ticket_id, subdomain, headers) {
  const attachmentsTokens = await fetchAndCloneAttachments(ticket_id, subdomain, headers);

  var payload = {
    "ticket": {
      "subject": ticket.subject,
      "comment": {
        "html_body": `Ticket clonado de: #${ticket_id}<br>${ticket.description}`,
        "uploads": attachmentsTokens
      },
      "tags": ["ticket_clone"],
      "recipient": recipient,
      "requester_id": ticket.requester_id,
      "via": {
        "channel": "mail"
      }
    }
  };

  const init = {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  };
  const result = await fetch("https://" + subdomain + ".zendesk.com/api/v2/tickets.json", init);  
  var json = await result.json();
  return json.audit.ticket_id;
}
export {
  worker_default as default
};
//# sourceMappingURL=index.js.map
