# Spotnana Bio

## What exactly is Spotnana?

They are a technology company building infrastructure for the travel industry.

When you book a trip, there are several key players involved, including:

- Travel providers: airlines, hotels, and ground transportation companies make their travel inventory available for purchase.
- Travel sellers: online travel agencies (OTAs) and corporate travel management companies (TMCs) provide an online shopping experience along with trained staff who can deliver assistance to travelers.
- Travel buyers: corporate and leisure travelers select travel options and provide a form of payment to complete a transaction.

Spotnana is working with all of these stakeholders to reimagine how travel is purchased, sold, and experienced. Our technology connects travel providers, travel sellers, and travel buyers through a single, unified travel platform. We are working to create a transparent relationship between travel providers and travel buyers that supports personalized shopping experiences and perfectly seamless, end-to-end travel journeys.

Spotnana is dedicated to rebuilding trust by providing access to the most comprehensive selection of travel content at competitive prices. Our cloud-travel platform taps into dozens of APIs to pull together travel content from the widest range of sources in real time, so travelers never feel the need to shop around. We then make this content available for purchase through a modern shopping experience.

Spotnana also provides the core infrastructure for travel sellers to service travelers. Our travel platform includes technology for travel agents to respond efficiently to customer requests as well as a comprehensive set of tools for travel sellers to manage customer deployments, access content sources, configure service fees, automate workflows, and more.

## Spotnana Architecture

The architecture of Spotnana’s Travel-as-a-Service platform is very different from other travel technology in a number of key ways:

- Access to comprehensive travel content – Over the past few decades, travel content sources have become highly fragmented, and most of the top travel providers have developed their own APIs. Spotnana integrates huge volumes of content from a large and growing number of APIs to provide the best available selection to travel buyers.
- Independent System of Record – Spotnana has its own System of Record for managing bookings, profiles, policies, analytics, and more. We also have developed an order management system that is independent of the PNR. This is a huge advantage, because it enables Spotnana to integrate more easily with other systems, connect all aspects of a trip through a single trip ID, and service travelers throughout their journey.
- Microservices-based architecture – Most travel platforms today are optimized to drive automation around text-based PNR files. Spotnana takes a different approach and uses microservices and databases to drive automation. This makes it easy for us to automate complex workflows, and it allows our travel platform to be highly configurable.
- Consumer-grade online booking experience – Spotnana makes it so easy to book and manage travel, that more than 90% of bookings, exchanges, and cancellations can happen without travelers needing to contact an agent for assistance.
- Single platform for travelers and agents – We enable travel agents and the travelers they serve to see the same content and data. This makes it much easier to deliver personalized service and quickly resolve issues.
- Global platform – Spotnana can be rolled out very quickly because we deploy a single instance of our software across all locations.
- Open platform with an API-first architecture – All of the core components of our system are built with open APIs, making it easy to integrate Spotnana with other systems and build new capabilities on top of our travel platform.

Here is a high level overview of how Spotnana’s Travel-as-a-Service platform is structured:

**SPOTNANA:**

- Online Booking Tool: Consumer-grade user experiences
- TMC Automation: Unified platform for TMCs and their customers
- Booking Engine: Microservices-based Architecture
- System of Record: Manages orders independent of the PNR
- Content Engine: Designed to work with any source of content
- APIs: Easy to integrate, embed, and build upon
- Integrations: Extensive set of pre-built integrations

Here is a summary of thier microservices-based architecture:

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

**KAFKA**

- KAFKA connects to ENS and ANALYTICS
- ANALYTICS connects to SPOTNANA DB

## How Spotnana delivers value to travelers

Spotnana’s technology is used by corporate and leisure travelers to book and manage trips, and the traveler will always be at the heart of everything we do. Every day our teams are working to provide access to more travel content, make travel experiences more seamless and self-service, and make it easier for travel managers to optimize their travel programs.

We make our technology available through a growing number of travel sellers and travel providers, including:

- Travel management companies (TMCs) – we have developed a comprehensive product suite for TMCs that includes TMC management tools, contact center tools, and extensive capabilities for increasing agent efficiency, all built on top of the full capabilities of our Travel-as-a-Service platform.
- Technology companies – our open travel platform is designed to be white labeled, embedded, and deeply integrated with other software products, websites, and mobile apps. This means we can enable any company to add a travel shopping experience to their product suite.
- Travel providers – Spotnana works directly with top travel providers to modernize content distribution and retailing. Our travel platform can also be embedded in a travel provider’s website and used to deliver a modern SMB booking site that supports deep integration with loyalty platforms.
- Leisure travel agencies – TMCs focused on leisure travel and OTAs can use our APIs to power travel experiences for their customers.
