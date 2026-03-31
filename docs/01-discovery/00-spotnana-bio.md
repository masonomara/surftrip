# Spotnana Bio

## What is Spotnana?

Spotnana is a travel infrastructure company. Their platform connects three parties:

- **Travel providers** – airlines, hotels, and ground transportation companies
- **Travel sellers** – online travel agencies (OTAs) and corporate travel management companies (TMCs)
- **Travel buyers** – corporate and leisure travelers

Their platform aggregates content from dozens of provider APIs and makes it available through a booking interface. They also provide tooling for travel agents and TMC operators to manage deployments, service fees, workflows, and customer accounts.

## Architecture

Spotnana's platform is built on microservices rather than PNR-based automation. Key characteristics:

- **Independent System of Record** – manages bookings, profiles, policies, and analytics independent of the PNR, using a single trip ID across all systems
- **Content aggregation** – integrates content from many provider APIs in real time
- **Configurable** – microservices architecture allows complex workflow automation and per-customer configuration
- **Single deployment** – one software instance deployed globally
- **API-first** – all core components expose open APIs for integration and embedding
- **Shared view** – agents and travelers see the same content and data
- **High self-service rate** – 90%+ of bookings, exchanges, and cancellations complete without agent involvement

### Platform components

- Online Booking Tool
- TMC Automation
- Booking Engine
- System of Record
- Content Engine
- APIs
- Integrations

### Microservices architecture

**MAIN FLOW:**

- UI connects to MASTER
- MASTER connects to BOOKING ENGINE
- BOOKING ENGINE connects to CONTENT
- CONTENT connects to KAFKA

**AUTHORIZATION:**

- AUTH PROVIDER and AUTH SERVICE connects to MASTER
- AUTH PROVIDER connects to SPOTNANA DB

**PROFILE:**

- PROFILE connects to MASTER, BOOKING ENGINE, KAFKA, and SPOTNANA DB

**POLICY:**

- POLICY connects to SPOTNANA DB and BOOKING ENGINE

**CONTENT:**

- CONTENT connects to THIRD-PARTY VENDORS and SPOTNANA DB

**KAFKA:**

- KAFKA connects to ENS and ANALYTICS
- ANALYTICS connects to SPOTNANA DB

## Customer segments

- **TMCs** – full product suite including management tools, contact center tools, and agent efficiency tooling
- **Technology companies** – platform can be white-labeled, embedded, or integrated into other products
- **Travel providers** – direct integrations for content distribution; platform can be embedded in provider websites for SMB booking
- **Leisure agencies and OTAs** – API access to power booking experiences
