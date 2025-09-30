# API Specification

## REST API Specification

```yaml
openapi: 3.0.0
info:
  title: IPODhan API
  version: 1.0.0
  description: REST API for IPO intelligence and scoring
servers:
  - url: https://api.ipodhan.com/v1
    description: Production API
  - url: https://staging-api.ipodhan.com/v1
    description: Staging API

paths:
  /ipos:
    get:
      summary: List IPOs
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [LIVE, UPCOMING, CLOSED]
        - name: category
          in: query
          schema:
            type: string
            enum: [MAINBOARD, SME]
      responses:
        200:
          description: List of IPOs
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/IPO'

  /ipos/{id}:
    get:
      summary: Get IPO details
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        200:
          description: IPO details with score
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/IPOWithScore'

  /ipos/{id}/score:
    get:
      summary: Get IPO score details
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        200:
          description: Detailed score breakdown
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/IPOScore'

  /ipos/{id}/gmp:
    get:
      summary: Get GMP history
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
        - name: days
          in: query
          schema:
            type: integer
            default: 7
      responses:
        200:
          description: GMP history
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/GMPHistory'

  /ipos/{id}/subscription:
    get:
      summary: Get subscription status
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        200:
          description: Current subscription data
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/SubscriptionData'

  /users/watchlist:
    get:
      summary: Get user watchlist
      security:
        - bearerAuth: []
      responses:
        200:
          description: User's IPO watchlist
        401:
          description: Unauthorized

  /webhooks/whatsapp:
    post:
      summary: WhatsApp webhook endpoint
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
      responses:
        200:
          description: Webhook processed

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key

  schemas:
    IPO:
      type: object
      required: [id, symbol, companyName]
      properties:
        id:
          type: string
        symbol:
          type: string
        companyName:
          type: string
        # ... other properties

    IPOScore:
      type: object
      required: [totalScore, verdict]
      properties:
        totalScore:
          type: number
          minimum: 0
          maximum: 100
        verdict:
          type: string
          enum: [APPLY, CONSIDER, SKIP]
        # ... other properties
```
