export type DeliveryPersonType = "TREKKER" | "RIDER";
export type DeliveryPersonStatus = "ONLINE" | "OFFLINE" | "PAUSED";
export type OrderPriority = "STANDARD" | "HIGH" | "URGENT";

export type Location = {
  latitude: number;
  longitude: number;
};

export type RouteCommitment = {
  orderId: string;
  expectedCompletionAt: number;
  expectedLocation: Location;
  latestDropoffAt: number;
};

export type DeliveryPerson = {
  id: string;
  type: DeliveryPersonType;
  status: DeliveryPersonStatus;
  location: Location;
  maxActiveDeliveries: number;
  activeDeliveries: RouteCommitment[];
  averageSpeedKph: number;
};

export type Vendor = {
  id: string;
  name: string;
  zone: string;
  location: Location;
  preparationMinutes: number;
  preparationVarianceMinutes: number;
};

export type Order = {
  id: string;
  vendorId: string;
  customerLabel: string;
  vendorLocation: Location;
  customerLocation: Location;
  createdAt: number;
  priority: OrderPriority;
  predictedReadyAt: number;
  actualReadyAt: number;
};

export type Delivery = {
  id: string;
  orderId: string;
  deliveryPersonId: string;
  assignedAt: number;
  status: "ASSIGNED" | "PICKED_UP" | "DELIVERED";
};
