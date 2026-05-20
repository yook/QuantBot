export interface TablePageParams {
  projectStore: any;
  projectId: string | number;
  sort?: any;
  skip?: number;
  limit?: number;
  db?: string;
  filters?: any[];
}

export interface TableCountParams {
  ipcClient: any;
  projectId: string | number;
  db?: string;
  filters?: any[];
}

export declare function loadTablePage(params: TablePageParams): Promise<any>;
export declare function reloadFirstPage(params: TablePageParams): Promise<any>;
export declare function loadTablePageAndCount(
  params: TablePageParams & { ipcClient: any },
): Promise<number>;
export declare function loadTableCount(params: TableCountParams): Promise<number>;
